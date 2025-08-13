const express = require('express');
const router = express.Router();
const passport = require('passport');
const Member = require('../models/member');
const Service = require('../models/service');
const Attendance = require('../models/attendance');
const User = require('../models/user');
const smsService = require('../services/smsService');
const analysisService = require('../services/analysisService');
const config = require('../config');

// Apply user to all templates so it's available in the navbar
router.use(function(req, res, next) {
  res.locals.user = req.user;
  next();
});

// --- Middleware to check if user is authenticated ---
function isAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }
    res.redirect('/login');
}

// --- Authentication Routes ---
router.get('/login', (req, res) => res.render('login'));
router.post('/login', passport.authenticate('local', {
    successRedirect: '/',
    failureRedirect: '/login',
    failureFlash: false // Or use true and configure connect-flash
}));
router.get('/register', isAuthenticated, async (req, res) => {
    try {
        const usersWithMembers = await User.find({ member: { $ne: null } }).select('member');
        const linkedMemberIds = usersWithMembers.map(u => u.member);
        const unlinkedMembers = await Member.find({ _id: { $nin: linkedMemberIds }, isActive: true });
        res.render('register', { unlinkedMembers, error: null });
    } catch (err) {
        console.error("Error loading registration page:", err);
        res.status(500).send("Error loading page");
    }
});

router.post('/register', isAuthenticated, async (req, res) => {
    try {
        const { username, password, memberId } = req.body;
        const user = new User({ username, password, member: memberId || null });
        await user.save();
        res.redirect('/login');
    } catch (err) {
        const usersWithMembers = await User.find({ member: { $ne: null } }).select('member');
        const linkedMemberIds = usersWithMembers.map(u => u.member);
        const unlinkedMembers = await Member.find({ _id: { $nin: linkedMemberIds }, isActive: true });
        res.render('register', { unlinkedMembers, error: 'Error registering. Username might be taken.' });
    }
});
router.get('/logout', (req, res, next) => {
    req.logout(function(err) {
        if (err) { return next(err); }
        res.redirect('/login');
    });
});

// --- Dashboard ---
router.get('/', isAuthenticated, async (req, res) => {
    try {
        const recentServices = await Service.find().sort({ serviceDate: -1 }).limit(10);
        res.render('dashboard', { services: recentServices });
    } catch (err) {
        res.status(500).send('Error loading dashboard');
    }
});

// --- Member Routes ---
router.get('/members', isAuthenticated, async (req, res) => {
    const members = await Member.find({ isActive: true });
    res.render('members', { members });
});
router.get('/members/add', isAuthenticated, (req, res) => res.render('add-member'));
router.post('/members/add', isAuthenticated, async (req, res) => {
    const { firstName, lastName, phoneNumber, email } = req.body;
    const newMember = new Member({ firstName, lastName, phoneNumber, email });
    await newMember.save();
    res.redirect('/members');
});

// Show edit member form
router.get('/members/edit/:id', isAuthenticated, async (req, res) => {
    try {
        const member = await Member.findById(req.params.id);
        const elders = await Member.find({ isElder: true, isActive: true });
        res.render('edit-member', { member, elders });
    } catch (err) {
        console.error("Error loading member for edit:", err);
        res.status(500).send("Error loading page");
    }
});

// Handle edit member form
router.post('/members/edit/:id', isAuthenticated, async (req, res) => {
    try {
        const { firstName, lastName, phoneNumber, email, isElder, shepherd } = req.body;
        await Member.findByIdAndUpdate(req.params.id, {
            firstName,
            lastName,
            phoneNumber,
            email,
            isElder: !!isElder,
            shepherd: shepherd || null
        });
        res.redirect('/members');
    } catch (err) {
        console.error("Error updating member:", err);
        res.status(500).send("Error updating member");
    }
});

// --- Shepherd's Dashboard ---
router.get('/shepherd', isAuthenticated, async (req, res) => {
    try {
        if (!req.user.member || !req.user.member.isElder) {
            return res.status(403).send('You are not authorized to view this page.');
        }

        const shepherdedMembers = await Member.find({ shepherd: req.user.member._id, isActive: true });

        res.render('shepherd', {
            elder: req.user.member,
            shepherdedMembers: shepherdedMembers,
            error: req.query.error,
            success: req.query.success
        });
    } catch (err) {
        console.error("Error loading shepherd dashboard:", err);
        res.status(500).send("Error loading dashboard");
    }
});

router.post('/shepherd/send-sms', isAuthenticated, async (req, res) => {
    try {
        const { message, recipients } = req.body;

        if (!recipients || recipients.length === 0) {
            return res.redirect('/shepherd?error=no_recipients');
        }

        const recipientIds = Array.isArray(recipients) ? recipients : [recipients];
        await smsService.sendBulkSms(recipientIds, message);

        res.redirect('/shepherd?success=sms_sent');
    } catch (err) {
        console.error("Error sending shepherd SMS:", err);
        res.redirect('/shepherd?error=send_failed');
    }
});

// --- Service Routes ---
router.get('/services', isAuthenticated, async (req, res) => {
    try {
        const services = await Service.find();
        res.render('services', { services });
    } catch (err) {
        res.status(500).send('Error loading services');
    }
});

router.get('/services/add', isAuthenticated, (req, res) => res.render('add-service'));

router.post('/services/add', isAuthenticated, async (req, res) => {
    const { serviceDate, topic, speaker } = req.body;
    const newService = new Service({ serviceDate, topic, speaker });
    await newService.save();
    res.redirect('/services');
});

router.post('/services/update-date', isAuthenticated, async (req, res) => {
    try {
        const { serviceId, newDate } = req.body;
        await Service.findByIdAndUpdate(serviceId, { serviceDateTime: newDate });
        res.json({ success: true });
    } catch (err) {
        console.error('Error updating service date:', err);
        res.status(500).json({ success: false });
    }
});

// --- Attendance Tracking Route (The Core) ---
router.get('/services/:id', isAuthenticated, async (req, res) => {
    try {
        const service = await Service.findById(req.params.id);
        const allMembers = await Member.find({ isActive: true }).sort({ lastName: 1 });
        const attendanceRecords = await Attendance.find({ service: req.params.id });
        
        const attendedMemberIds = new Set(attendanceRecords.map(a => a.member.toString()));

        res.render('service-detail', { service, allMembers, attendedMemberIds });
    } catch (err) {
        res.status(500).send("Error loading service details");
    }
});

// --- Mark Attendance Route ---
router.post('/attendance/mark', isAuthenticated, async (req, res) => {
    const { serviceId, attendees } = req.body;
    const service = await Service.findById(serviceId);

    // Ensure attendees is an array
    const newAttendeeIds = Array.isArray(attendees) ? attendees : (attendees ? [attendees] : []);

    // Clear existing attendance for this service
    await Attendance.deleteMany({ service: serviceId });

    if (newAttendeeIds.length > 0) {
        const attendanceData = [];
        for (const memberId of newAttendeeIds) {
            attendanceData.push({ service: serviceId, member: memberId });

            // Check for first visit
            const member = await Member.findById(memberId);
            const hasAttendedBefore = await Attendance.findOne({ member: memberId, service: { $ne: serviceId } });

            if (!member.firstVisit && !hasAttendedBefore) {
                member.firstVisit = service.serviceDateTime;
                await member.save();
            }
        }
        await Attendance.insertMany(attendanceData);
    }

    res.redirect(`/services/${serviceId}`);
});

// --- Send SMS Route ---
router.post('/services/:id/send-sms', isAuthenticated, async (req, res) => {
    try {
        const serviceId = req.params.id;
        const result = await smsService.sendAttendanceFollowUps(serviceId);
        console.log('SMS Sending Result:', result);
        res.redirect(`/services/${serviceId}?sms_sent=true`);
    } catch (error) {
        console.error('Failed to send SMS messages:', error);
        res.redirect(`/services/${serviceId}?sms_error=true`);
    }
});

// --- Reports Section ---
router.get('/reports/lapsed-members', isAuthenticated, async (req, res) => {
    try {
        const lapsedMembers = await analysisService.getLapsedMembers();
        res.render('lapsed-members', { 
            lapsedMembers: lapsedMembers,
            lapseLevels: config.lapseLevels
        });
    } catch (err) {
        console.error("Error generating lapsed member report:", err);
        res.status(500).send("Failed to generate report.");
    }
});

// --- Messaging Page ---
router.get('/messaging', isAuthenticated, async (req, res) => {
    try {
        const absentMembers = await analysisService.getAbsentMembers(3);
        const recentService = await Service.findOne().sort({ serviceDateTime: -1 });
        let firstTimeAttendees = [];
        if (recentService) {
            firstTimeAttendees = await analysisService.getFirstTimeAttendees(recentService._id);
        }

        res.render('messaging', {
            absentMembers,
            firstTimeAttendees,
            recentService
        });
    } catch (err) {
        console.error("Error loading messaging page:", err);
        res.status(500).send("Failed to load messaging page.");
    }
});


module.exports = router;
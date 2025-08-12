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
router.get('/register', (req, res) => res.render('register'));
router.post('/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = new User({ username, password });
        await user.save();
        res.redirect('/login');
    } catch (err) {
        res.render('register', { error: 'Error registering. Username might be taken.' });
    }
});
router.get('/logout', (req, res, next) => {
    req.logout(function(err) {
        if (err) { return next(err); }
        res.redirect('/login');
    });
});


// Apply user to all templates
router.use(function(req, res, next) {
  res.locals.user = req.user;
  next();
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

// --- Service Routes ---
router.get('/services/add', isAuthenticated, (req, res) => res.render('add-service'));
router.post('/services/add', isAuthenticated, async (req, res) => {
    const { serviceDate, topic, speaker } = req.body;
    const newService = new Service({ serviceDate, topic, speaker });
    await newService.save();
    res.redirect('/');
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
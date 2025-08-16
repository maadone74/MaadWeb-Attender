const express = require('express');
const router = express.Router();
const passport = require('passport');
const multer = require('multer');
const path = require('path');
const xlsx = require('xlsx');
const Member = require('../models/member');
const Visitor = require('../models/visitor');
const Service = require('../models/service');
const Attendance = require('../models/attendance');
const User = require('../models/user');
const smsService = require('../services/smsService');
const analysisService = require('../services/analysisService');
const config = require('../config');

// --- Multer Setup for File Uploads ---
const storage = multer.diskStorage({
    destination: './public/uploads/',
    filename: function(req, file, cb){
        cb(null, file.fieldname + '-' + Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 10000000 }, // 10MB limit
    fileFilter: function(req, file, cb){
        checkFileType(file, cb);
    }
}).single('picture');

const sheetUpload = multer({
    storage: storage,
    fileFilter: function(req, file, cb){
        checkSheetType(file, cb);
    }
}).single('sheet');

function checkSheetType(file, cb){
    const filetypes = /xlsx/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    if(extname){
        return cb(null,true);
    } else {
        cb('Error: Excel files Only!');
    }
}

function checkFileType(file, cb){
    const filetypes = /jpeg|jpg|png/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);

    if(mimetype && extname){
        return cb(null,true);
    } else {
        cb('Error: Images Only!');
    }
}

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

// --- People Page ---
router.get('/people', isAuthenticated, async (req, res) => {
    try {
        const members = await Member.find({ isActive: true });
        const visitors = await Visitor.find();
        const users = await User.find().populate('member');
        res.render('people', { members, visitors, users });
    } catch (err) {
        console.error("Error loading people page:", err);
        res.status(500).send("Error loading page");
    }
});

// --- Member Routes ---

router.get('/members/upload', isAuthenticated, (req, res) => {
    res.render('upload-sheet');
});

router.post('/members/upload', isAuthenticated, (req, res) => {
    sheetUpload(req, res, async (err) => {
        if (err) {
            return res.render('upload-sheet', { msg: err });
        }
        if (req.file == undefined) {
            return res.render('upload-sheet', { msg: 'Error: No File Selected!' });
        }

        const workbook = xlsx.readFile(req.file.path);
        const sheet_name_list = workbook.SheetNames;
        const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheet_name_list[0]]);

        let newMembers = 0;
        let existingMembers = 0;

        for (const row of data) {
            const { FirstName, LastName, PhoneNumber, Email } = row;
            if (!PhoneNumber) continue;

            const existingMember = await Member.findOne({ phoneNumber: PhoneNumber });
            if (!existingMember) {
                const newMember = new Member({
                    firstName: FirstName,
                    lastName: LastName,
                    phoneNumber: PhoneNumber,
                    email: Email
                });
                await newMember.save();
                newMembers++;
            } else {
                existingMembers++;
            }
        }

        res.render('upload-sheet', { msg: `File processed. Added ${newMembers} new members. Found ${existingMembers} existing members.` });
    });
});


router.post('/services/:id/upload-attendance', isAuthenticated, (req, res) => {
    sheetUpload(req, res, async (err) => {
        if (err) {
            return res.redirect(`/services/${req.params.id}?error=${err}`);
        }
        if (req.file == undefined) {
            return res.redirect(`/services/${req.params.id}?error=No file selected`);
        }

        const serviceId = req.params.id;
        const workbook = xlsx.readFile(req.file.path);
        const sheet_name_list = workbook.SheetNames;
        const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheet_name_list[0]]);

        let newVisitors = 0;
        let newAttendees = 0;

        for (const row of data) {
            const { FirstName, LastName, PhoneNumber, Email } = row;
            if (!PhoneNumber) continue;

            let member = await Member.findOne({ phoneNumber: PhoneNumber });
            if (member) {
                // Existing member, just mark attendance
                const existingAttendance = await Attendance.findOne({ service: serviceId, member: member._id });
                if (!existingAttendance) {
                    const attendance = new Attendance({ service: serviceId, member: member._id });
                    await attendance.save();
                    newAttendees++;
                }
            } else {
                // New visitor
                let visitor = await Visitor.findOne({ phoneNumber: PhoneNumber });
                if (!visitor) {
                    visitor = new Visitor({
                        firstName: FirstName,
                        lastName: LastName,
                        phoneNumber: PhoneNumber,
                        email: Email
                    });
                    await visitor.save();
                    newVisitors++;
                }
                // Mark attendance for the visitor
                const existingAttendance = await Attendance.findOne({ service: serviceId, visitor: visitor._id });
                if (!existingAttendance) {
                    const attendance = new Attendance({ service: serviceId, visitor: visitor._id });
                    await attendance.save();
                    newAttendees++;
                }
            }
        }

        res.redirect(`/services/${serviceId}?msg=Processed ${data.length} rows. Added ${newAttendees} attendees and ${newVisitors} new visitors.`);
    });
});

router.get('/members/add', isAuthenticated, (req, res) => res.render('add-member'));
router.post('/members/add', isAuthenticated, (req, res) => {
    upload(req, res, async (err) => {
        if(err){
            res.render('add-member', { msg: err });
        } else {
            const { firstName, lastName, phoneNumber, email } = req.body;
            const newMember = new Member({
                firstName,
                lastName,
                phoneNumber,
                email,
                picture: req.file ? `uploads/${req.file.filename}` : null
            });
            await newMember.save();
            res.redirect('/people');
        }
    });
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
router.post('/members/edit/:id', isAuthenticated, (req, res) => {
    upload(req, res, async (err) => {
        if(err){
            res.redirect(`/members/edit/${req.params.id}?error=${err}`);
        } else {
            try {
                const { firstName, lastName, phoneNumber, email, isElder, shepherd } = req.body;
                let updateData = {
                    firstName,
                    lastName,
                    phoneNumber,
                    email,
                    isElder: !!isElder,
                    shepherd: shepherd || null
                };

                if (req.file) {
                    updateData.picture = `uploads/${req.file.filename}`;
                }

                await Member.findByIdAndUpdate(req.params.id, updateData);
                res.redirect('/people');
            } catch (err) {
                console.error("Error updating member:", err);
                res.status(500).send("Error updating member");
            }
        }
    });
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
router.get('/servicecal', isAuthenticated, async (req, res) => {
    try {
        let services = await Service.find();
        // Ensure all serviceDateTime values are ISO strings for the calendar
        services = services.map(s => {
             const obj = s.toObject ? s.toObject() : s;
           return {
                ...obj,
                serviceDateTime: obj.serviceDateTime instanceof Date ? obj.serviceDateTime.toISOString() : new Date(obj.serviceDateTime).toISOString()
             };
         });
        res.render('servicecal', { services });
    } catch (err) {
        res.status(500).send('Error loading services');
    }
});

router.get('/services/add', isAuthenticated, (req, res) => res.render('add-service'));

router.post('/services/add', isAuthenticated, async (req, res) => {
    const { serviceDateTime, topic, speaker } = req.body;
    const newService = new Service({ serviceDateTime, topic, speaker });
    await newService.save();
    res.redirect('/servicecal');
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

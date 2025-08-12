const express = require('express');
const router = express.Router();
const Member = require('../models/member');
const Service = require('../models/service');
const Attendance = require('../models/attendance');
const smsService = require('../services/smsService');
const analysisService = require('../services/analysisService');
const config = require('../config'); // Also require the config
const e = require('express');

// --- Dashboard ---
router.get('/', async (req, res) => {
    try {
        const recentServices = await Service.find().sort({ serviceDate: -1 }).limit(10);
        res.render('dashboard', { services: recentServices });
    } catch (err) {
        res.status(500).send('Error loading dashboard');
    }
});

// --- Member Routes ---
router.get('/members', async (req, res) => {
    const members = await Member.find({ isActive: true });
    res.render('members', { members });
});
router.get('/members/add', (req, res) => res.render('add-member'));
router.post('/members/add', async (req, res) => {
    const { firstName, lastName, phoneNumber, email } = req.body;
    const newMember = new Member({ firstName, lastName, phoneNumber, email });
    await newMember.save();
    res.redirect('/members');
});

// --- Service Routes ---
router.get('/services/add', (req, res) => res.render('add-service'));
router.post('/services/add', async (req, res) => {
    const { serviceDate, topic, speaker } = req.body;
    const newService = new Service({ serviceDate, topic, speaker });
    await newService.save();
    res.redirect('/');
});

// --- Attendance Tracking Route (The Core) ---
router.get('/services/:id', async (req, res) => {
    try {
        const service = await Service.findById(req.params.id);
        const allMembers = await Member.find({ isActive: true }).sort({ lastName: 1 });
        const attendanceRecords = await Attendance.find({ service: req.params.id });
        
        // Create a Set of attended member IDs for quick lookup
        const attendedMemberIds = new Set(attendanceRecords.map(a => a.member.toString()));

        res.render('service-detail', { service, allMembers, attendedMemberIds });
    } catch (err) {
        res.status(500).send("Error loading service details");
    }
});

// --- Mark Attendance Route ---
router.post('/attendance/mark', async (req, res) => {
    const { serviceId, attendees } = req.body;

    // Easiest way to handle updates is to clear existing and add new
    await Attendance.deleteMany({ service: serviceId });

    if (typeof(attendees) == Array && attendees.length > 0) {
        const attendanceData = attendees.map(memberId => ({
            service: serviceId,
            member: memberId
        }));
        await Attendance.insertMany(attendanceData);
    } else {
        // If no attendees, just ensure we don't leave any records
        await Attendance.deleteMany({ service: serviceId });
         const attendanceData = {
            service: serviceId,
            member: attendees
        };
          await Attendance.insertMany(attendanceData);
    }

    res.redirect(`/services/${serviceId}`);
});

// --- Send SMS Route ---
router.post('/services/:id/send-sms', async (req, res) => {
    try {
        const serviceId = req.params.id;
        const result = await smsService.sendAttendanceFollowUps(serviceId);
        console.log('SMS Sending Result:', result);
        // Add a query param for a success message on the page
        res.redirect(`/services/${serviceId}?sms_sent=true`);
    } catch (error) {
        console.error('Failed to send SMS messages:', error);
        res.redirect(`/services/${serviceId}?sms_error=true`);
    }
});

// --- Reports Section ---
router.get('/reports/lapsed-members', async (req, res) => {
    try {
        const lapsedMembers = await analysisService.getLapsedMembers();
        res.render('lapsed-members', { 
            lapsedMembers: lapsedMembers,
            lapseLevels: config.lapseLevels // Pass config to the view
        });
    } catch (err) {
        console.error("Error generating lapsed member report:", err);
        res.status(500).send("Failed to generate report.");
    }
});

module.exports = router;
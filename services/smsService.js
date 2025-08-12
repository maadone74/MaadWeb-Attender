const Member = require('../models/member');
const Attendance = require('../models/attendance');
const Service = require('../models/service');
const twilio = require('twilio');

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;

async function sendAttendanceFollowUps(serviceId) {
    // 1. Get all active members and the service details
    const allMembers = await Member.find({ isActive: true });
    const service = await Service.findById(serviceId);

    // 2. Get IDs of members who attended
    const attendanceRecords = await Attendance.find({ service: serviceId });
    const attendedMemberIds = new Set(attendanceRecords.map(a => a.member.toString()));

    const serviceDateFormatted = service.serviceDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    // 3. Determine who was present and who was absent
    const promises = allMembers.map(member => {
        let messageBody = '';
        
        if (attendedMemberIds.has(member._id.toString())) {
            // This member was present
            messageBody = `Hi ${member.firstName}, thanks for joining us at church this past Sunday! We were blessed to have you with us.`;
        } else {
            // This member was absent
            messageBody = `Hi ${member.firstName}, we missed you at church on Sunday. We hope you have a blessed week and look forward to seeing you soon!`;
        }
        
        // Use Twilio to send the message
        return client.messages.create({
            body: messageBody,
            from: twilioPhoneNumber,
            to: member.phoneNumber // Assumes US numbers for now. Add country code logic if international.
        }).then(message => ({ success: true, sid: message.sid }))
          .catch(err => ({ success: false, error: err.message, member: member.firstName }));
    });
    
    // 4. Execute all promises
    return Promise.all(promises);
}

module.exports = { sendAttendanceFollowUps };

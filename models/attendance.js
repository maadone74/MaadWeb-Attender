const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema({
    member: { type: mongoose.Schema.Types.ObjectId, ref: 'Member', required: true },
    service: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', required: true }
});

// Ensure a member can only be marked as present once per service
attendanceSchema.index({ member: 1, service: 1 }, { unique: true });

module.exports = mongoose.model('Attendance', attendanceSchema);



const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema({
    member: { type: mongoose.Schema.Types.ObjectId, ref: 'Member' },
    visitor: { type: mongoose.Schema.Types.ObjectId, ref: 'Visitor' },
    service: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', required: true }
});

// Ensure a person (member or visitor) can only be marked as present once per service
attendanceSchema.index({ service: 1, member: 1 }, { unique: true, partialFilterExpression: { member: { $exists: true } } });
attendanceSchema.index({ service: 1, visitor: 1 }, { unique: true, partialFilterExpression: { visitor: { $exists: true } } });

module.exports = mongoose.model('Attendance', attendanceSchema);



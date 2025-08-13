const mongoose = require('mongoose');

const memberSchema = new mongoose.Schema({
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    phoneNumber: { type: String, required: true, unique: true },
    email: { type: String },
    memberSince: { type: Date, default: Date.now },
    firstVisit: { type: Date },
    isActive: { type: Boolean, default: true },
    isElder: { type: Boolean, default: false },
    shepherd: { type: mongoose.Schema.Types.ObjectId, ref: 'Member' }
});

module.exports = mongoose.model('Member', memberSchema);

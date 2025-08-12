const mongoose = require('mongoose');

const memberSchema = new mongoose.Schema({
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    phoneNumber: { type: String, required: true, unique: true },
    email: { type: String },
    memberSince: { type: Date, default: Date.now },
    isActive: { type: Boolean, default: true }
});

module.exports = mongoose.model('Member', memberSchema);

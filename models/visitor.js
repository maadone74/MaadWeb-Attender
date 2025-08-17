const mongoose = require('mongoose');

const visitorSchema = new mongoose.Schema({
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    phoneNumber: { type: String, required: true, unique: true },
    email: { type: String },
    firstVisit: { type: Date, default: Date.now },
    status: { type: String, default: 'new' } // e.g., new, contacted, attending
});

module.exports = mongoose.model('Visitor', visitorSchema);

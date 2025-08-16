require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/user');
const Member = require('./models/member');

const dbURI = process.env.MONGODB_URI;
console.log('Attempting to connect to MongoDB...');
mongoose.connect(dbURI, { serverSelectionTimeoutMS: 5000 })
    .then(async () => {
        console.log('MongoDB connected successfully.');
        const member = new Member({
            firstName: 'Admin',
            lastName: 'User',
            phoneNumber: '1234567890',
            email: 'admin@example.com',
            isElder: true
        });
        await member.save();

        const user = new User({
            username: 'admin',
            password: 'password',
            member: member._id
        });
        await user.save();
        console.log('User created successfully');
        mongoose.connection.close();
    })
    .catch(err => console.error('MongoDB connection error:', err));

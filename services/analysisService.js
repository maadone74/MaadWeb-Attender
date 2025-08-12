const mongoose = require('mongoose');
const Member = require('../models/member');
const Attendance = require('../models/attendance');
const Service = require('../models/service');
const config = require('../config');

// Function to get the last attendance date for all members efficiently
async function getLastAttendanceDates() {
    // Use MongoDB's aggregation pipeline for performance
    const lastAttendanceList = await Attendance.aggregate([
        // 1. Join with the services collection to get the date of each attendance
        {
            $lookup: {
                from: Service.collection.name,
                localField: 'service',
                foreignField: '_id',
                as: 'serviceInfo'
            }
        },
        // 2. Unwind the serviceInfo array created by $lookup
        { $unwind: '$serviceInfo' },
        // 3. Sort by date descending to find the most recent one first
        { $sort: { 'serviceInfo.serviceDate': -1 } },
        // 4. Group by member and grab the very first (most recent) date
        {
            $group: {
                _id: '$member',
                lastAttended: { $first: '$serviceInfo.serviceDateTime' }
            }
        }
    ]);
    
    // Convert the result array into a Map for O(1) lookup time
    // Map will look like: { memberId => lastAttendedDate }
    return new Map(lastAttendanceList.map(item => [item._id.toString(), item.lastAttended]));
}

async function getLapsedMembers() {
    const allMembers = await Member.find({ isActive: true });
    const lastAttendanceMap = await getLastAttendanceDates();
    const now = new Date();
    
    const { level4, level3, level2, level1 } = config.lapseLevels;
    
    const lapsedMembers = [];

    for (const member of allMembers) {
        const lastAttended = lastAttendanceMap.get(member._id.toString());
        let daysLapsed = Infinity; // Assume infinitely lapsed if never attended
        let level = 0;

        if (lastAttended) {
            // Calculate the difference in milliseconds, then convert to days
            const diffTime = now.getTime() - lastAttended.getTime();
            daysLapsed = Math.floor(diffTime / (1000 * 60 * 60 * 24));
        }

        // Determine the lapse level by checking from highest to lowest
        if (daysLapsed > level4) {
            level = 4;
        } else if (daysLapsed > level3) {
            level = 3;
        } else if (daysLapsed > level2) {
            level = 2;
        } else if (daysLapsed > level1) {
            level = 1;
        }

        // Only include members who are at least Level 1 lapsed
        if (level > 0) {
            lapsedMembers.push({
                info: member,
                level: level,
                daysLapsed: daysLapsed === Infinity ? 'N/A' : daysLapsed,
                lastAttended: lastAttended || null
            });
        }
    }
    
    // Sort by level (desc) and then by days lapsed (desc)
    lapsedMembers.sort((a, b) => {
        if (b.level !== a.level) {
            return b.level - a.level;
        }
        return b.daysLapsed - a.daysLapsed;
    });
    
    return lapsedMembers;
}

module.exports = { getLapsedMembers };

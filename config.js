// This file contains application-wide configurations.
// All time-based values are in days.

module.exports = {
    // Defines the thresholds for member lapse levels.
    // A member is considered at a certain level if they have not
    // attended for more than the specified number of days.
    lapseLevels: {
        level1: 90,     // 3 months
        level2: 182,    // 6 months
        level3: 365,    // 1 year
        level4: 730,    // 2 years
    }
};

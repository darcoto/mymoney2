/**
 * ISO 3166-1 alpha-3 country codes with flag emojis
 */

const COUNTRY_CODES = {
    'ABW': { name: 'Aruba', flag: '🇦🇼' },
    'AFG': { name: 'Afghanistan', flag: '🇦🇫' },
    'AGO': { name: 'Angola', flag: '🇦🇴' },
    'ALB': { name: 'Albania', flag: '🇦🇱' },
    'AND': { name: 'Andorra', flag: '🇦🇩' },
    'ARE': { name: 'United Arab Emirates', flag: '🇦🇪' },
    'ARG': { name: 'Argentina', flag: '🇦🇷' },
    'ARM': { name: 'Armenia', flag: '🇦🇲' },
    'AUS': { name: 'Australia', flag: '🇦🇺' },
    'AUT': { name: 'Austria', flag: '🇦🇹' },
    'AZE': { name: 'Azerbaijan', flag: '🇦🇿' },
    'BEL': { name: 'Belgium', flag: '🇧🇪' },
    'BEN': { name: 'Benin', flag: '🇧🇯' },
    'BGD': { name: 'Bangladesh', flag: '🇧🇩' },
    'BGR': { name: 'Bulgaria', flag: '🇧🇬' },
    'BHR': { name: 'Bahrain', flag: '🇧🇭' },
    'BIH': { name: 'Bosnia and Herzegovina', flag: '🇧🇦' },
    'BLR': { name: 'Belarus', flag: '🇧🇾' },
    'BRA': { name: 'Brazil', flag: '🇧🇷' },
    'BRN': { name: 'Brunei', flag: '🇧🇳' },
    'CAN': { name: 'Canada', flag: '🇨🇦' },
    'CHE': { name: 'Switzerland', flag: '🇨🇭' },
    'CHL': { name: 'Chile', flag: '🇨🇱' },
    'CHN': { name: 'China', flag: '🇨🇳' },
    'COL': { name: 'Colombia', flag: '🇨🇴' },
    'CRI': { name: 'Costa Rica', flag: '🇨🇷' },
    'CUB': { name: 'Cuba', flag: '🇨🇺' },
    'CYP': { name: 'Cyprus', flag: '🇨🇾' },
    'CZE': { name: 'Czech Republic', flag: '🇨🇿' },
    'DEU': { name: 'Germany', flag: '🇩🇪' },
    'DNK': { name: 'Denmark', flag: '🇩🇰' },
    'DOM': { name: 'Dominican Republic', flag: '🇩🇴' },
    'DZA': { name: 'Algeria', flag: '🇩🇿' },
    'ECU': { name: 'Ecuador', flag: '🇪🇨' },
    'EGY': { name: 'Egypt', flag: '🇪🇬' },
    'ESP': { name: 'Spain', flag: '🇪🇸' },
    'EST': { name: 'Estonia', flag: '🇪🇪' },
    'ETH': { name: 'Ethiopia', flag: '🇪🇹' },
    'FIN': { name: 'Finland', flag: '🇫🇮' },
    'FRA': { name: 'France', flag: '🇫🇷' },
    'GBR': { name: 'United Kingdom', flag: '🇬🇧' },
    'GEO': { name: 'Georgia', flag: '🇬🇪' },
    'GHA': { name: 'Ghana', flag: '🇬🇭' },
    'GRC': { name: 'Greece', flag: '🇬🇷' },
    'GRL': { name: 'Greenland', flag: '🇬🇱' },
    'HKG': { name: 'Hong Kong', flag: '🇭🇰' },
    'HRV': { name: 'Croatia', flag: '🇭🇷' },
    'HUN': { name: 'Hungary', flag: '🇭🇺' },
    'IDN': { name: 'Indonesia', flag: '🇮🇩' },
    'IND': { name: 'India', flag: '🇮🇳' },
    'IRL': { name: 'Ireland', flag: '🇮🇪' },
    'IRN': { name: 'Iran', flag: '🇮🇷' },
    'IRQ': { name: 'Iraq', flag: '🇮🇶' },
    'ISL': { name: 'Iceland', flag: '🇮🇸' },
    'ISR': { name: 'Israel', flag: '🇮🇱' },
    'ITA': { name: 'Italy', flag: '🇮🇹' },
    'JAM': { name: 'Jamaica', flag: '🇯🇲' },
    'JOR': { name: 'Jordan', flag: '🇯🇴' },
    'JPN': { name: 'Japan', flag: '🇯🇵' },
    'KAZ': { name: 'Kazakhstan', flag: '🇰🇿' },
    'KEN': { name: 'Kenya', flag: '🇰🇪' },
    'KGZ': { name: 'Kyrgyzstan', flag: '🇰🇬' },
    'KOR': { name: 'South Korea', flag: '🇰🇷' },
    'KWT': { name: 'Kuwait', flag: '🇰🇼' },
    'LBN': { name: 'Lebanon', flag: '🇱🇧' },
    'LIE': { name: 'Liechtenstein', flag: '🇱🇮' },
    'LKA': { name: 'Sri Lanka', flag: '🇱🇰' },
    'LTU': { name: 'Lithuania', flag: '🇱🇹' },
    'LUX': { name: 'Luxembourg', flag: '🇱🇺' },
    'LVA': { name: 'Latvia', flag: '🇱🇻' },
    'MAR': { name: 'Morocco', flag: '🇲🇦' },
    'MCO': { name: 'Monaco', flag: '🇲🇨' },
    'MDA': { name: 'Moldova', flag: '🇲🇩' },
    'MEX': { name: 'Mexico', flag: '🇲🇽' },
    'MKD': { name: 'North Macedonia', flag: '🇲🇰' },
    'MLT': { name: 'Malta', flag: '🇲🇹' },
    'MNE': { name: 'Montenegro', flag: '🇲🇪' },
    'MNG': { name: 'Mongolia', flag: '🇲🇳' },
    'MYS': { name: 'Malaysia', flag: '🇲🇾' },
    'NGA': { name: 'Nigeria', flag: '🇳🇬' },
    'NLD': { name: 'Netherlands', flag: '🇳🇱' },
    'NOR': { name: 'Norway', flag: '🇳🇴' },
    'NPL': { name: 'Nepal', flag: '🇳🇵' },
    'NZL': { name: 'New Zealand', flag: '🇳🇿' },
    'OMN': { name: 'Oman', flag: '🇴🇲' },
    'PAK': { name: 'Pakistan', flag: '🇵🇰' },
    'PAN': { name: 'Panama', flag: '🇵🇦' },
    'PER': { name: 'Peru', flag: '🇵🇪' },
    'PHL': { name: 'Philippines', flag: '🇵🇭' },
    'POL': { name: 'Poland', flag: '🇵🇱' },
    'PRT': { name: 'Portugal', flag: '🇵🇹' },
    'PRY': { name: 'Paraguay', flag: '🇵🇾' },
    'QAT': { name: 'Qatar', flag: '🇶🇦' },
    'ROU': { name: 'Romania', flag: '🇷🇴' },
    'RUS': { name: 'Russia', flag: '🇷🇺' },
    'SAU': { name: 'Saudi Arabia', flag: '🇸🇦' },
    'SGP': { name: 'Singapore', flag: '🇸🇬' },
    'SRB': { name: 'Serbia', flag: '🇷🇸' },
    'SVK': { name: 'Slovakia', flag: '🇸🇰' },
    'SVN': { name: 'Slovenia', flag: '🇸🇮' },
    'SWE': { name: 'Sweden', flag: '🇸🇪' },
    'THA': { name: 'Thailand', flag: '🇹🇭' },
    'TUN': { name: 'Tunisia', flag: '🇹🇳' },
    'TUR': { name: 'Turkey', flag: '🇹🇷' },
    'TWN': { name: 'Taiwan', flag: '🇹🇼' },
    'UKR': { name: 'Ukraine', flag: '🇺🇦' },
    'URY': { name: 'Uruguay', flag: '🇺🇾' },
    'USA': { name: 'United States', flag: '🇺🇸' },
    'UZB': { name: 'Uzbekistan', flag: '🇺🇿' },
    'VEN': { name: 'Venezuela', flag: '🇻🇪' },
    'VNM': { name: 'Vietnam', flag: '🇻🇳' },
    'ZAF': { name: 'South Africa', flag: '🇿🇦' }
};

/**
 * Check if a string is a valid ISO 3166-1 alpha-3 country code
 * @param {string} code - The code to check
 * @returns {boolean}
 */
function isValidCountryCode(code) {
    return code && COUNTRY_CODES.hasOwnProperty(code.toUpperCase());
}

/**
 * Get country info by code
 * @param {string} code - ISO 3166-1 alpha-3 code
 * @returns {object|null} Country info with name and flag, or null if not found
 */
function getCountryInfo(code) {
    if (!code) return null;
    return COUNTRY_CODES[code.toUpperCase()] || null;
}

/**
 * Extract country code from counterparty name if it starts with "XXX " pattern
 * @param {string} counterpartyName - Counterparty name
 * @returns {string|null} Country code or null
 */
function extractCountryFromCounterparty(counterpartyName) {
    if (!counterpartyName || counterpartyName.length < 4) return null;

    // Check if starts with 3 uppercase letters followed by space
    const match = counterpartyName.match(/^([A-Z]{3})\s/);
    if (!match) return null;

    const potentialCode = match[1];
    return isValidCountryCode(potentialCode) ? potentialCode : null;
}

/**
 * Get all country codes as array
 * @returns {Array} Array of {code, name, flag}
 */
function getAllCountries() {
    return Object.entries(COUNTRY_CODES).map(([code, info]) => ({
        code,
        name: info.name,
        flag: info.flag
    }));
}

module.exports = {
    COUNTRY_CODES,
    isValidCountryCode,
    getCountryInfo,
    extractCountryFromCounterparty,
    getAllCountries
};

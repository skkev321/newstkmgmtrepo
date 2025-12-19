// src/components/formatters.js

// Formatters
export const currencyFormatter = new Intl.NumberFormat('en-LK', { // Changed to en-LK for LKR formatting
    style: 'currency',
    currency: 'LKR', // Changed to LKR
});

export const percentageFormatter = new Intl.NumberFormat('en-US', {
    style: 'percent',
    maximumFractionDigits: 2,
});
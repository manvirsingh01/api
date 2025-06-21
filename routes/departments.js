/**
 * @file Department management API routes using Google Sheets.
 * @description Handles creating, updating, and listing departments.
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { google } = require('googleapis');

const router = express.Router();

// --- Google Sheets Authentication ---

// --- Google API Configuration (FIXED FOR LOCAL & VERCEL) ---
let auth;
// Check if running on a deployed server (like Vercel)
if (process.env.GOOGLE_CREDENTIALS) {
    const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
    });
} else {
    // Use the local file for local development
    auth = new google.auth.GoogleAuth({
        keyFile: 'credentials.json',
        scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
    });
}
const sheets = google.sheets({ version: 'v4', auth: auth });

// The ID of your spreadsheet that contains the 'Departments' and 'Employees' tabs.
const SPREADSHEET_ID = '16P-msveFT6sAav0wAPTU_wZ2tLiQiThgz0Vutpebo8c'; // <-- PASTE YOUR SHEET ID HERE

/**
 * Helper function to find a row index by its ID in a given sheet.
 * @param {string} sheetName - The name of the tab (e.g., 'Departments').
 * @param {string} id - The ID to search for in the first column.
 * @returns {Promise<number>} The 1-based index of the row, or -1 if not found.
 */
async function findRowIndexById(sheetName, id) {
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheetName}!A:A`, // Search in the first column (IDs)
    });
    const rows = response.data.values;
    if (rows) {
        for (let i = 0; i < rows.length; i++) {
            if (rows[i][0] === id) {
                return i + 1; // Sheets API rows are 1-based
            }
        }
    }
    return -1; // Not found
}


/**
 * @route   POST /api/departments/create
 * @desc    Creates a new department.
 */
router.post('/create', async (req, res) => {
    try {
        const { departmentName, description, location } = req.body;
        if (!departmentName || !location) {
            return res.status(400).json({ msg: 'Department Name and Location are required.' });
        }

        const departmentId = uuidv4();
        const timestamp = new Date().toISOString();

        // --- Google Sheets Logic: Append a new row ---
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Departments!A:G', // The range of columns for a department
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: [
                    // DepartmentID, DepartmentName, Description, Location, InChargeEmployeeID, CreatedAt, UpdatedAt
                    [departmentId, departmentName, description || '', location, '', timestamp, timestamp]
                ]
            },
        });

        res.status(201).json({ msg: 'Department created successfully!', data: { departmentId, departmentName } });

    } catch (err) {
        console.error('Error creating department:', err.message);
        res.status(500).send('Server Error');
    }
});


/**
 * @route   POST /api/departments/update/:departmentId
 * @desc    Updates a department's details, including the person in charge.
 */
router.post('/update/:departmentId', async (req, res) => {
    try {
        const { departmentId } = req.params;
        const { departmentName, description, location, inChargeEmployeeId } = req.body;

        // --- Google Sheets Logic: Find and Update ---
        const rowIndex = await findRowIndexById('Departments', departmentId);

        if (rowIndex === -1) {
            return res.status(404).json({ msg: 'Department not found.' });
        }

        // First, get the existing data to avoid overwriting anything not provided in the request
        const existingDataResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `Departments!A${rowIndex}:G${rowIndex}`
        });
        
        const existingData = existingDataResponse.data.values[0];

        // Prepare the updated row. Use new value if provided, otherwise keep existing.
        const updatedRow = [
            departmentId, // Column A (ID) doesn't change
            departmentName || existingData[1],
            description || existingData[2],
            location || existingData[3],
            inChargeEmployeeId || existingData[4],
            existingData[5], // Keep original CreatedAt
            new Date().toISOString() // Update UpdatedAt timestamp
        ];

        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `Departments!A${rowIndex}:G${rowIndex}`,
            valueInputOption: 'USER_ENTERED',
            resource: { values: [updatedRow] },
        });

        res.status(200).json({ msg: 'Department updated successfully!', data: { departmentId, ...req.body } });

    } catch (err) {
        console.error('Error updating department:', err.message);
        res.status(500).send('Server Error');
    }
});


/**
 * @route   GET /api/departments/list
 * @desc    Retrieves a list of all departments.
 */
router.get('/list', async (req, res) => {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Departments!A:G',
        });

        const rows = response.data.values;
        if (!rows || rows.length <= 1) {
            return res.status(200).json({ msg: 'No departments found.', data: [] });
        }

        const headers = rows[0];
        const departments = rows.slice(1).map(row => {
            let dept = {};
            headers.forEach((header, index) => {
                dept[header] = row[index];
            });
            return dept;
        });

        res.status(200).json({ msg: 'Departments retrieved successfully.', data: departments });

    } catch (err) {
        console.error('Error listing departments:', err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;

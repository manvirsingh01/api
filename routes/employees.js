/**
 * @file Employee management API routes using Google Sheets.
 * @description Handles creating, updating, and listing employee profiles.
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
 * @route   POST /api/employees/create
 * @desc    Creates a new employee profile.
 */
router.post('/create', async (req, res) => {
    try {
        const { employeeName, departmentId, email, phone, role, responsibilities } = req.body;
        if (!employeeName || !departmentId || !role) {
            return res.status(400).json({ msg: 'Employee Name, Department ID, and Role are required.' });
        }

        const employeeId = uuidv4();
        const timestamp = new Date().toISOString();

        // --- Google Sheets Logic: Append a new row ---
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Employees!A:I', // The range of columns for an employee
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: [
                    // EmployeeID, EmployeeName, DepartmentID, Email, Phone, Role, Responsibilities, CreatedAt, UpdatedAt
                    [employeeId, employeeName, departmentId, email || '', phone || '', role, responsibilities || '', timestamp, timestamp]
                ]
            },
        });

        res.status(201).json({ msg: 'Employee created successfully!', data: { employeeId, employeeName } });

    } catch (err) {
        console.error('Error creating employee:', err.message);
        res.status(500).send('Server Error');
    }
});


/**
 * @route   POST /api/employees/update/:employeeId
 * @desc    Updates an employee's profile.
 */
router.post('/update/:employeeId', async (req, res) => {
    try {
        const { employeeId } = req.params;
        const { employeeName, departmentId, email, phone, role, responsibilities } = req.body;

        // Helper function to find row index (can be defined locally or imported)
        async function findRowIndexById(sheetName, id) {
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: `${sheetName}!A:A`,
            });
            const rows = response.data.values;
            if (rows) {
                for (let i = 0; i < rows.length; i++) {
                    if (rows[i][0] === id) return i + 1;
                }
            }
            return -1;
        }

        const rowIndex = await findRowIndexById('Employees', employeeId);

        if (rowIndex === -1) {
            return res.status(404).json({ msg: 'Employee not found.' });
        }

        // Get existing data to avoid overwriting fields
        const existingDataResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `Employees!A${rowIndex}:I${rowIndex}`
        });
        const existingData = existingDataResponse.data.values[0];

        // Prepare the updated row
        const updatedRow = [
            employeeId,
            employeeName || existingData[1],
            departmentId || existingData[2],
            email || existingData[3],
            phone || existingData[4],
            role || existingData[5],
            responsibilities || existingData[6],
            existingData[7], // Keep original CreatedAt
            new Date().toISOString() // Update UpdatedAt timestamp
        ];

        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `Employees!A${rowIndex}:I${rowIndex}`,
            valueInputOption: 'USER_ENTERED',
            resource: { values: [updatedRow] },
        });

        res.status(200).json({ msg: 'Employee updated successfully!', data: { employeeId, ...req.body } });

    } catch (err) {
        console.error('Error updating employee:', err.message);
        res.status(500).send('Server Error');
    }
});


/**
 * @route   GET /api/employees/list
 * @desc    Retrieves a list of all employees.
 */
router.get('/list', async (req, res) => {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Employees!A:I',
        });

        const rows = response.data.values;
        if (!rows || rows.length <= 1) {
            return res.status(200).json({ msg: 'No employees found.', data: [] });
        }

        const headers = rows[0];
        const employees = rows.slice(1).map(row => {
            let emp = {};
            headers.forEach((header, index) => {
                emp[header] = row[index];
            });
            return emp;
        });

        res.status(200).json({ msg: 'Employees retrieved successfully.', data: employees });

    } catch (err) {
        console.error('Error listing employees:', err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;

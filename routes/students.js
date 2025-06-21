/**
 * @file Student management API routes using Google Sheets.
 * @description Handles creating, updating, and listing student profiles.
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

// The ID of your spreadsheet that contains the 'Departments', 'Employees', and 'Students' tabs.
const SPREADSHEET_ID = '16P-msveFT6sAav0wAPTU_wZ2tLiQiThgz0Vutpebo8c'; // <-- PASTE YOUR SHEET ID HERE

/**
 * @route   POST /api/students/create
 * @desc    Creates a new student profile.
 */
router.post('/create', async (req, res) => {
    try {
        const { studentName, rollNumber, departmentId, course, yearOfStudy, email, phone } = req.body;
        if (!studentName || !rollNumber || !departmentId || !course || !yearOfStudy) {
            return res.status(400).json({ msg: 'Student Name, Roll Number, Department, Course, and Year of Study are required.' });
        }

        const studentId = uuidv4();
        const timestamp = new Date().toISOString();

        // --- Google Sheets Logic: Append a new row ---
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Students!A:J', // The range of columns for a student
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: [
                    // StudentID, StudentName, RollNumber, DepartmentID, Course, YearOfStudy, Email, Phone, CreatedAt, UpdatedAt
                    [studentId, studentName, rollNumber, departmentId, course, yearOfStudy, email || '', phone || '', timestamp, timestamp]
                ]
            },
        });

        res.status(201).json({ msg: 'Student created successfully!', data: { studentId, studentName, rollNumber } });

    } catch (err) {
        console.error('Error creating student:', err.message);
        res.status(500).send('Server Error');
    }
});


/**
 * @route   POST /api/students/update/:studentId
 * @desc    Updates a student's profile.
 */
router.post('/update/:studentId', async (req, res) => {
    try {
        const { studentId } = req.params;
        const { studentName, rollNumber, departmentId, course, yearOfStudy, email, phone } = req.body;

        // Helper function to find row index by its ID
        async function findRowIndexById(sheetName, id) {
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: `${sheetName}!A:A`,
            });
            const rows = response.data.values;
            if (rows) {
                for (let i = 0; i < rows.length; i++) {
                    if (rows[i][0] === id) return i + 1; // 1-based index
                }
            }
            return -1;
        }

        const rowIndex = await findRowIndexById('Students', studentId);

        if (rowIndex === -1) {
            return res.status(404).json({ msg: 'Student not found.' });
        }

        // Get existing data to avoid overwriting fields not included in the request
        const existingDataResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `Students!A${rowIndex}:J${rowIndex}`
        });
        const existingData = existingDataResponse.data.values[0];

        // Prepare the updated row with new or existing data
        const updatedRow = [
            studentId, // ID doesn't change
            studentName || existingData[1],
            rollNumber || existingData[2],
            departmentId || existingData[3],
            course || existingData[4],
            yearOfStudy || existingData[5],
            email || existingData[6],
            phone || existingData[7],
            existingData[8], // Keep original CreatedAt
            new Date().toISOString() // Update UpdatedAt timestamp
        ];

        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `Students!A${rowIndex}:J${rowIndex}`,
            valueInputOption: 'USER_ENTERED',
            resource: { values: [updatedRow] },
        });

        res.status(200).json({ msg: 'Student updated successfully!', data: { studentId, ...req.body } });

    } catch (err) {
        console.error('Error updating student:', err.message);
        res.status(500).send('Server Error');
    }
});


/**
 * @route   GET /api/students/list
 * @desc    Retrieves a list of all students.
 */
router.get('/list', async (req, res) => {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Students!A:J',
        });

        const rows = response.data.values;
        if (!rows || rows.length <= 1) {
            return res.status(200).json({ msg: 'No students found.', data: [] });
        }

        const headers = rows[0];
        const students = rows.slice(1).map(row => {
            let student = {};
            headers.forEach((header, index) => {
                student[header] = row[index] || ''; // Ensure value is not undefined
            });
            return student;
        });

        res.status(200).json({ msg: 'Students retrieved successfully.', data: students });

    } catch (err) {
        console.error('Error listing students:', err.message);
        res.status(500).send('Server Error');
    }
});

/**
 * @route   GET /api/students/list/:departmentId
 * @desc    Retrieves a list of all students belonging to a specific department.
 */
router.get('/list/:departmentId', async (req, res) => {
    try {
        const { departmentId } = req.params;

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Students!A:J',
        });

        const rows = response.data.values;
        if (!rows || rows.length <= 1) {
            return res.status(200).json({ msg: 'No students found.', data: [] });
        }

        const headers = rows[0];
        const departmentIdIndex = headers.indexOf('DepartmentID');

        if (departmentIdIndex === -1) {
            return res.status(500).json({ msg: '"DepartmentID" header not found in sheet.' });
        }

        const students = rows.slice(1)
            .filter(row => row[departmentIdIndex] === departmentId) // Filter by departmentId
            .map(row => {
                let student = {};
                headers.forEach((header, index) => {
                    student[header] = row[index] || '';
                });
                return student;
            });

        res.status(200).json({ 
            msg: `Found ${students.length} students for the specified department.`, 
            data: students 
        });

    } catch (err) {
        console.error('Error listing students by department:', err.message);
        res.status(500).send('Server Error');
    }
});


module.exports = router;

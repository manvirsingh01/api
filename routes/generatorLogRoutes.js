/**
 * @file Generator Log API routes using Google Drive for image storage.
 * @description Handles generator logging, uploading photos directly to a specified Google Drive folder.
 */

const express = require('express');
const multer = require('multer');
const { google } = require('googleapis');
const { Readable } = require('stream');

const router = express.Router();

// --- Google API Configuration ---

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

// Create clients for both Sheets and Drive
const sheets = google.sheets({ version: 'v4', auth: auth });
const drive = google.drive({ version: 'v3', auth: auth });

// The ID of your spreadsheet
const SPREADSHEET_ID = '1N3v2DYcl316s9qdEzmDitZxj-fVcDV58Bqjps45wcxY'; // <-- PASTE YOUR SHEET ID
// The ID of the Google Drive folder where images will be uploaded
const DRIVE_FOLDER_ID = '1yaKKiJkfgaqxaHIWfU13MEJhuy0IT1J7'; // <-- PASTE YOUR FOLDER ID (can be the same as the bus log)

// --- Multer Configuration for In-Memory Storage ---
const upload = multer({ storage: multer.memoryStorage() });

// --- Helper function to upload a file to Google Drive ---
async function uploadToGoogleDrive(fileObject) {
    const bufferStream = new Readable();
    bufferStream.push(fileObject.buffer);
    bufferStream.push(null);

    try {
        const { data } = await drive.files.create({
            media: {
                mimeType: fileObject.mimetype,
                body: bufferStream,
            },
            requestBody: {
                name: fileObject.originalname,
                parents: [DRIVE_FOLDER_ID],
            },
            fields: 'id, webViewLink',
        });

        await drive.permissions.create({
            fileId: data.id,
            requestBody: {
                role: 'reader',
                type: 'anyone',
            },
        });
        return data;
    } catch (err) {
        console.error('Error uploading to Google Drive:', err);
        return null;
    }
}


/**
 * @route   POST /api/generatorlog/start-run
 * @desc    Records start of a run, uploads photo to Drive, and logs to Sheets.
 */
router.post('/start-run', upload.single('controlPanelPhoto'), async (req, res) => {
    try {
        const { startingFuelLevel, runId } = req.body;
        const photoFile = req.file;

        if (!startingFuelLevel || !runId) return res.status(400).json({ msg: 'Starting Fuel Level and Run ID are required.' });
        if (!photoFile) return res.status(400).json({ msg: 'Control panel photo is required.' });

        const driveResponse = await uploadToGoogleDrive(photoFile);
        if (!driveResponse) {
            return res.status(500).json({ msg: 'Failed to upload image to Google Drive.' });
        }

        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Sheet1!A:J',
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: [
                    [new Date().toISOString(), 'START', runId, startingFuelLevel, driveResponse.webViewLink]
                ],
            },
        });

        res.status(201).json({ msg: 'Generator run started successfully!', data: { runId, startingFuelLevel, photoUrl: driveResponse.webViewLink } });

    } catch (err) {
        console.error('Error starting generator run:', err.message);
        res.status(500).send('Server Error');
    }
});


/**
 * @route   POST /api/generatorlog/end-run
 * @desc    Records end of a run, uploads photo to Drive, and logs to Sheets.
 */
router.post('/end-run', upload.single('controlPanelPhoto'), async (req, res) => {
    try {
        const { endingFuelLevel, remarks, runId } = req.body;
        const photoFile = req.file;

        if (!endingFuelLevel || !runId) return res.status(400).json({ msg: 'Ending Fuel Level and Run ID are required.' });
        if (!photoFile) return res.status(400).json({ msg: 'Control panel photo is required.' });

        const driveResponse = await uploadToGoogleDrive(photoFile);
        if (!driveResponse) {
            return res.status(500).json({ msg: 'Failed to upload image to Google Drive.' });
        }

        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Sheet1!A:J',
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: [
                    [new Date().toISOString(), 'END', runId, endingFuelLevel, driveResponse.webViewLink, '', '', '', '', remarks || '']
                ],
            },
        });

        res.status(200).json({ msg: 'Generator run ended successfully!', data: { runId, endingFuelLevel, photoUrl: driveResponse.webViewLink } });

    } catch (err) {
        console.error('Error ending generator run:', err.message);
        res.status(500).send('Server Error');
    }
});

// The /create-log route does not handle file uploads, so it remains unchanged.
router.post('/create-log', async (req, res) => {
    try {
        const { runId, location, operatorId, scheduledStartTime, scheduledEndTime } = req.body;
        if (!runId || !location || !operatorId || !scheduledStartTime || !scheduledEndTime) {
            return res.status(400).json({ msg: 'Please provide all required log details.' });
        }
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Sheet1!A:J',
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: [[new Date().toISOString(), 'CREATE', runId, '', '', location, operatorId, scheduledStartTime, scheduledEndTime]]
            },
        });
        res.status(201).json({ msg: 'Generator log created successfully!', data: req.body });
    } catch (err) {
        console.error('Error creating generator log:', err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;

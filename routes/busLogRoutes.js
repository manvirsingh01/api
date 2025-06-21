/**
 * @file Bus Log API routes using Google Drive for image storage.
 * @description Handles bus trip logging, uploading photos directly to a specified Google Drive folder.
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
const SPREADSHEET_ID = '1M3JkvcPPdDxrrapgicsHkb2w_Dja5-pN5_Q5EDu2u5s'; // <-- PASTE YOUR SHEET ID
// The ID of the Google Drive folder where images will be uploaded
const DRIVE_FOLDER_ID = '1GDy_3FQB920etDL9FWkIU-_HZYLNXVz9'; // <-- PASTE YOUR FOLDER ID

// --- Multer Configuration for In-Memory Storage ---
// Change storage to memoryStorage to handle the file as a buffer
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
                parents: [DRIVE_FOLDER_ID], // Specify the folder
            },
            fields: 'id, webViewLink', // Get the file ID and web link
        });

        // Make the file publicly accessible so the link works for anyone
        await drive.permissions.create({
            fileId: data.id,
            requestBody: {
                role: 'reader',
                type: 'anyone',
            },
        });

        return data; // returns { id, webViewLink }
    } catch (err) {
        console.error('Error uploading to Google Drive:', err);
        return null;
    }
}


/**
 * @route   POST /api/buslog/start-trip
 * @desc    Records start of a trip, uploads photo to Drive, and logs to Sheets.
 */
router.post('/start-trip', upload.single('dashboardPhoto'), async (req, res) => {
    try {
        const { startingKm, tripId } = req.body;
        const dashboardPhotoFile = req.file;

        if (!startingKm || !tripId) return res.status(400).json({ msg: 'Starting KM and Trip ID are required.' });
        if (!dashboardPhotoFile) return res.status(400).json({ msg: 'Dashboard photo is required.' });

        // Upload the image to Google Drive
        const driveResponse = await uploadToGoogleDrive(dashboardPhotoFile);
        if (!driveResponse) {
            return res.status(500).json({ msg: 'Failed to upload image to Google Drive.' });
        }
        
        // --- Google Sheets Logic ---
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Sheet1!A:K',
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: [
                    // Save the Google Drive link instead of a local path
                    [new Date().toISOString(), 'START', tripId, startingKm, driveResponse.webViewLink]
                ],
            },
        });

        res.status(201).json({ msg: 'Trip started successfully!', data: { tripId, startingKm, photoUrl: driveResponse.webViewLink } });

    } catch (err) {
        console.error('Error starting trip:', err.message);
        res.status(500).send('Server Error');
    }
});


/**
 * @route   POST /api/buslog/end-trip
 * @desc    Records end of a trip, uploads photo to Drive, and logs to Sheets.
 */
router.post('/end-trip', upload.single('dashboardPhoto'), async (req, res) => {
    try {
        const { endingKm, remarks, tripId } = req.body;
        const dashboardPhotoFile = req.file;

        if (!endingKm || !tripId) return res.status(400).json({ msg: 'Ending KM and Trip ID are required.' });
        if (!dashboardPhotoFile) return res.status(400).json({ msg: 'Dashboard photo is required.' });

        // Upload the image to Google Drive
        const driveResponse = await uploadToGoogleDrive(dashboardPhotoFile);
        if (!driveResponse) {
            return res.status(500).json({ msg: 'Failed to upload image to Google Drive.' });
        }

        // --- Google Sheets Logic ---
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Sheet1!A:K',
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: [
                    // Save the Google Drive link instead of a local path
                    [new Date().toISOString(), 'END', tripId, endingKm, driveResponse.webViewLink, '', '', '', '', '', remarks || '']
                ],
            },
        });

        res.status(200).json({ msg: 'Trip ended successfully!', data: { tripId, endingKm, photoUrl: driveResponse.webViewLink } });

    } catch (err) {
        console.error('Error ending trip:', err.message);
        res.status(500).send('Server Error');
    }
});

// The /create-trip route does not handle file uploads, so it remains unchanged.
router.post('/create-trip', async (req, res) => {
    try {
        const { tripId, startLocation, endLocation, driverId, startTime, endTime } = req.body;
        if (!tripId || !startLocation || !endLocation || !driverId || !startTime || !endTime) {
            return res.status(400).json({ msg: 'Please provide all required trip details.' });
        }
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Sheet1!A:K',
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: [[new Date().toISOString(), 'CREATE', tripId, '', '', startLocation, endLocation, driverId, startTime, endTime]]
            },
        });
        res.status(201).json({ msg: 'Trip created successfully!', data: req.body });
    } catch (err) {
        console.error('Error creating trip:', err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;

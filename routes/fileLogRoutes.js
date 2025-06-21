/**
 * @file File Movement Log API routes with QR Code generation and Google Drive storage.
 * @description Handles registering a file, generating a QR code, uploading it to Google Drive,
 * and then logging the details and QR code link to a Google Sheet.
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { google } = require('googleapis');
const qrcode = require('qrcode');
const { Readable } = require('stream'); // Required for streaming to Google Drive

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

const SPREADSHEET_ID = '1UGtMVujl_yzprHCBu_t3ho_fWK9p8vrTA2e2v8ftaYU'; // <-- PASTE YOUR SHEET ID
const DRIVE_FOLDER_ID = '1fL9cQOSSkXYCtX-ldxtBP7k7eYZqlixO'; // <-- PASTE YOUR QR CODE FOLDER ID

/**
 * Helper function to upload a file buffer to Google Drive.
 * @param {object} qrFile - An object containing the file buffer, name, and mimetype.
 * @returns {Promise<object|null>} The Google Drive file metadata or null on failure.
 */
async function uploadToGoogleDrive(qrFile) {
    const bufferStream = new Readable();
    bufferStream.push(qrFile.buffer);
    bufferStream.push(null);

    try {
        const { data } = await drive.files.create({
            media: {
                mimeType: qrFile.mimetype,
                body: bufferStream,
            },
            requestBody: {
                name: qrFile.originalname,
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
 * @route   POST /api/filelog/register
 * @desc    Registers a new file, generates a QR code, uploads it to Drive, and logs to Sheets.
 */
router.post('/register', async (req, res) => {
    try {
        const { fileName, description, originatingDepartment, createdBy } = req.body;
        if (!fileName || !originatingDepartment || !createdBy) {
            return res.status(400).json({ msg: 'File Name, Originating Department, and Creator are required.' });
        }

        const fileId = uuidv4();
        const timestamp = new Date().toISOString();

        // --- Generate QR Code as a Buffer ---
        const qrCodeBuffer = await qrcode.toBuffer(fileId);

        // --- Upload QR Code to Google Drive ---
        const qrFile = {
            buffer: qrCodeBuffer,
            originalname: `${fileId}.png`,
            mimetype: 'image/png'
        };
        const driveResponse = await uploadToGoogleDrive(qrFile);
        if (!driveResponse) {
            return res.status(500).json({ msg: 'Failed to upload QR Code to Google Drive.' });
        }

        // --- Create File Record ---
        const newFile = {
            fileId,
            fileName,
            description: description || '',
            originatingDepartment,
            createdBy,
            createdAt: timestamp,
            qrCodeUrl: driveResponse.webViewLink // The public URL to the QR code image
        };

        // --- Google Sheets Logic ---
        // 1. Add to the 'Files' master list, now including the QR code link.
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Files!A:G', // Update range to include the new column
            valueInputOption: 'USER_ENTERED',
            // Add the qrCodeUrl to the row
            resource: { values: [[fileId, fileName, newFile.description, originatingDepartment, createdBy, timestamp, newFile.qrCodeUrl]] },
        });

        // 2. Add the first entry to the 'Movements' log
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Movements!A:I',
            valueInputOption: 'USER_ENTERED',
            resource: { values: [[timestamp, fileId, 'REGISTERED', '', originatingDepartment, createdBy, '', '', 'File created.']] },
        });

        // --- Send Response ---
        // The response now includes the file details AND the public URL to the QR code.
        res.status(201).json({
            msg: 'File registered successfully! A QR code has been generated and saved to Google Drive.',
            data: newFile
        });

    } catch (err) {
        console.error('Error registering file:', err.message);
        res.status(500).send('Server Error');
    }
});


// ... (The /forward, /receive, and /status/:fileId routes remain unchanged) ...

/**
 * @route   POST /api/filelog/forward
 * @desc    Forwards a file. Appends a 'FORWARDED' row to the 'Movements' tab.
 */
router.post('/forward', async (req, res) => {
    try {
        const { fileId, fromDepartment, toDepartment, forwardedBy, workDone, workToBeDone, remarks } = req.body;
        if (!fileId || !fromDepartment || !toDepartment || !forwardedBy) {
            return res.status(400).json({ msg: 'File ID, From/To Departments, and User are required.' });
        }
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Movements!A:I',
            valueInputOption: 'USER_ENTERED',
            resource: { values: [[new Date().toISOString(), fileId, 'FORWARDED', fromDepartment, toDepartment, forwardedBy, workDone, workToBeDone, remarks]] },
        });
        res.status(200).json({ msg: `File forwarded to ${toDepartment}. Awaiting receipt.` });
    } catch (err) {
        console.error('Error forwarding file:', err.message);
        res.status(500).send('Server Error');
    }
});

/**
 * @route   POST /api/filelog/receive
 * @desc    Receives a file. Appends a 'RECEIVED' row to the 'Movements' tab.
 */
router.post('/receive', async (req, res) => {
    try {
        const { fileId, receivingDepartment, receivedBy, remarks } = req.body;
        if (!fileId || !receivingDepartment || !receivedBy) {
            return res.status(400).json({ msg: 'File ID, Receiving Department, and User are required.' });
        }
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Movements!A:I',
            valueInputOption: 'USER_ENTERED',
            resource: { values: [[new Date().toISOString(), fileId, 'RECEIVED', '', receivingDepartment, receivedBy, '', '', remarks]] },
        });
        res.status(200).json({ msg: `File successfully received by ${receivingDepartment}.` });
    } catch (err) {
        console.error('Error receiving file:', err.message);
        res.status(500).send('Server Error');
    }
});

/**
 * @route   GET /api/filelog/status/:fileId
 * @desc    Gets file status and history by reading and filtering the 'Movements' sheet.
 */
router.get('/status/:fileId', async (req, res) => {
    try {
        const { fileId } = req.params;
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Movements!A:I',
        });
        const rows = response.data.values || [];
        if (rows.length <= 1) {
            return res.status(404).json({ msg: 'No movement history found.' });
        }
        const headers = rows[0];
        const fileHistoryRows = rows.slice(1).filter(row => row[1] === fileId);
        if (fileHistoryRows.length === 0) {
            return res.status(404).json({ msg: 'File not found or has no history.' });
        }
        const history = fileHistoryRows.map(row => {
            let logEntry = {};
            headers.forEach((header, index) => { logEntry[header] = row[index]; });
            return logEntry;
        });
        const latestStatus = history[history.length - 1];
        res.status(200).json({
            msg: 'File history retrieved successfully.',
            data: {
                details: { fileId: fileId, currentStatus: latestStatus.Action, currentLocation: latestStatus.ToDepartment, lastUpdated: latestStatus.Timestamp },
                history: history,
            }
        });
    } catch (err) {
        console.error('Error fetching file status:', err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;


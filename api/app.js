/**
 * @file Main Express application file.
 * @description This file initializes the Express server and connects all the API route modules.
 * It serves as the entry point for the application.
 */

const express = require('express');

// --- Import all route modules ---
// Make sure the path to these files is correct based on your project structure.
// It's common practice to put route files in a 'routes' directory.
const busLogRoutes = require('../routes/busLogRoutes');
const generatorLogRoutes = require('../routes/generatorLogRoutes');
const fileLogRoutes = require('../routes/fileLogRoutes');
const departmentRoutes = require('../routes/departments');
const employeeRoutes = require('../routes/employees');
const studentRoutes = require('../routes/students');

// Initialize the Express app
const app = express();

// --- Middleware ---
// This middleware is used to parse incoming JSON bodies from requests.
// It's necessary for reading data from POST/PUT requests like req.body.
app.use(express.json());

// --- Define API Routes ---
// The server will use the imported route modules for any requests matching these paths.
// For example, a request to /api/students/list will be handled by the studentRoutes module.
app.use('/api/buslog', busLogRoutes);
app.use('/api/generatorlog', generatorLogRoutes);
app.use('/api/filelog', fileLogRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/students', studentRoutes);

// --- Root Route ---
// A simple GET route to confirm that the server is running.
// You can access this by navigating to http://localhost:PORT in your browser.
app.get('/', (req, res) => {
    res.status(200).send('API Server is running successfully.');
});

// --- Server Configuration ---
// Define the port the server will listen on.
// Use the environment variable PORT if available, otherwise default to 5000.
const PORT = process.env.PORT || 5000;

// --- Start the Server ---
// The app.listen() function starts a UNIX socket and listens for connections on the specified path.
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

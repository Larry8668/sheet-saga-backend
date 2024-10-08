const { google } = require("googleapis");
const {
  updateCellInDB,
  deleteCellInDB,
  appendRowToDB,
} = require("../helpers/dbUpdate");

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.VERCEL_GOOGLE_APPLICATION_CREDENTIALS),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

const updateEntireRow = async (req, res) => {
  try {
    const { spreadsheetId, sheetName, row, values } = req.body;

    if (!spreadsheetId || !row || !Array.isArray(values)) {
      return res.status(400).json({ error: "Missing required parameters" });
    }

    // Update the database and check if it was successful
    const dbUpdateResult = await updateCellInDB(
      spreadsheetId,
      sheetName,
      row,
      values
    );

    if (!dbUpdateResult.success) {
      return res.status(400).json({
        error: "Failed to update database",
        details: dbUpdateResult.message,
      });
    }

    // Convert row to A1 notation
    const range = `${sheetName ? sheetName + "!" : ""}${row + 1}:${row + 1}`;

    // Update the entire row
    const response = await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: "RAW",
      resource: {
        values: [values],
      },
    });

    res.json({
      success: true,
      message: `Row ${row} updated successfully`,
      updatedCells: response.data.updatedCells,
    });
  } catch (error) {
    console.error("Error updating row:", error);
    res
      .status(500)
      .json({ error: "Failed to update row", details: error.message });
  }
};

const deleteRow = async (req, res) => {
  try {
    const { spreadsheetId, sheetId, row } = req.body;

    if (!spreadsheetId || !`${sheetId}` || !row) {
      return res.status(400).json({ error: "Missing required parameters" });
    }

    // Delete from database and check if it was successful
    const dbDeleteResult = await deleteCellInDB(spreadsheetId, sheetId, row);

    if (!dbDeleteResult.success) {
      return res.status(400).json({
        error: "Failed to update database",
        details: dbDeleteResult.message,
      });
    }

    // Create the request body
    const requests = [
      {
        deleteDimension: {
          range: {
            sheetId: sheetId,
            dimension: "ROWS",
            startIndex: row, // 0-based index
            endIndex: row + 1, // Exclusive
          },
        },
      },
    ];

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: { requests },
    });

    res.json({
      success: true,
      message: `Row ${row} deleted successfully`,
    });
  } catch (error) {
    console.error("Error deleting row:", error);
    res
      .status(500)
      .json({ error: "Failed to delete row", details: error.message });
  }
};

const insertRow = async (req, res) => {
  try {
    const { spreadsheetId, sheetId, sheetName, row, values } = req.body;

    if (!spreadsheetId || !sheetId || !row || !Array.isArray(values)) {
      return res.status(400).json({ error: "Missing required parameters" });
    }

    const requests = [
      {
        insertDimension: {
          range: {
            sheetId: sheetId,
            dimension: "ROWS",
            startIndex: row - 1, // 0-based index for insertion
            endIndex: row - 1, // Exclusive
          },
          inheritFromBefore: false,
        },
      },
    ];

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: { requests },
    });

    // Now update the newly inserted row with values
    const range = `${sheetName}!${row}:${row}`; // Use sheetId to construct the range
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: "RAW",
      resource: {
        values: [values], // values should be an array of values for the new row
      },
    });

    res.json({
      success: true,
      message: `Row inserted at index ${row} successfully`,
    });
  } catch (error) {
    console.error("Error inserting row:", error);
    res
      .status(500)
      .json({ error: "Failed to insert row", details: error.message });
  }
};

const appendRow = async (req, res) => {
  try {
    const { spreadsheetId, sheetName, values } = req.body;

    // Check if the required parameters are present
    if (!spreadsheetId || !sheetName || !Array.isArray(values)) {
      return res.status(400).json({ error: "Missing required parameters" });
    }

    // Append to the database
    const dbAppendResult = await appendRowToDB(
      spreadsheetId,
      sheetName,
      values
    );

    if (!dbAppendResult.success) {
      return res.status(400).json({
        error: "Failed to update database",
        details: dbAppendResult.message,
      });
    }

    const range = `${sheetName}!A1`; // A1 is just a reference point; it will append to the end

    // Append the row
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range,
      valueInputOption: "RAW",
      resource: {
        values: [values], // values should be an array of values for the new row
      },
    });

    res.json({
      success: true,
      message: `Row appended successfully`,
      updatedCells: response.data.updates.updatedCells,
    });
  } catch (error) {
    console.error("Error appending row:", error);
    return res
      .status(500)
      .json({ error: "Internal server error", details: error.message });
  }
};

module.exports = { updateEntireRow, deleteRow, insertRow, appendRow };

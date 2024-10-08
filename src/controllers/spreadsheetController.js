const { google } = require("googleapis");
const supabase = require("../supabaseClient");

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.VERCEL_GOOGLE_APPLICATION_CREDENTIALS),
  scopes: [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.metadata.readonly",
  ],
});

async function processSpreadsheet(spreadsheetId) {
  // Check if the spreadsheet already exists
  const { data: existingSpreadsheet, error: selectError } = await supabase
    .from("spreadsheet")
    .select("*")
    .eq("spreadsheet_id", spreadsheetId)
    .single();

  if (selectError && selectError.code !== "PGRST116") {
    throw selectError;
  }

  let spreadsheetData;

  if (existingSpreadsheet) {
    console.log("existingSpreadsheet", existingSpreadsheet);
    spreadsheetData = existingSpreadsheet;
  } else {
    // Insert the new spreadsheet
    const { error: insertError } = await supabase
      .from("spreadsheet")
      .insert([{ spreadsheet_id: spreadsheetId }])
      .single();

    if (insertError) {
      throw insertError;
    }

    const newSpreadsheet = await supabase
      .from("spreadsheet")
      .select("*")
      .eq("spreadsheet_id", spreadsheetId)
      .single();

    spreadsheetData = newSpreadsheet.data;
    console.log("newSpreadsheet", spreadsheetData);

    // Get the list of sheets using Google Sheets API
    const client = await auth.getClient();
    const googleSheets = google.sheets({ version: "v4", auth: client });

    const { data } = await googleSheets.spreadsheets.get({
      spreadsheetId: spreadsheetId,
    });

    const sheets = data.sheets;

    // Create new sheets in the database
    for (const sheet of sheets) {
      console.log("checking sheet", sheet);
      await processSheet({
        spreadsheetId: spreadsheetData.id,
        sheetId: sheet.properties.sheetId,
        sheetName: sheet.properties.title,
        actualSpreadsheetId: spreadsheetId,
      });
    }
  }

  return { spreadsheetData, isNew: !existingSpreadsheet };
}

async function processSheet(sheetData) {
  const { spreadsheetId, sheetId, sheetName, actualSpreadsheetId } = sheetData;

  if (!spreadsheetId || !`${sheetId}` || !sheetName) {
    throw new Error("Spreadsheet ID, sheet ID, and sheet name are required.");
  }

  const { data: existingSheet, error: selectError } = await supabase
    .from("sheet")
    .select("*")
    .eq("sheet_id", sheetId)
    .single();

  if (selectError && selectError.code !== "PGRST116") {
    throw selectError;
  }

  let sheetResult;

  if (existingSheet) {
    console.log("existingSheet", existingSheet);
    sheetResult = existingSheet;
  } else {
    const { error: insertError } = await supabase
      .from("sheet")
      .insert([
        {
          spreadsheet_id: spreadsheetId,
          sheet_name: sheetName,
          sheet_id: sheetId,
        },
      ])
      .single();

    if (insertError) {
      throw insertError;
    }

    const newSheet = await supabase
      .from("sheet")
      .select("*")
      .eq("sheet_id", sheetId)
      .single();

    sheetResult = newSheet.data;
    console.log("newSheet", sheetResult);

    // Fetch rows for the new sheet using actualSpreadsheetId
    const client = await auth.getClient();
    const googleSheets = google.sheets({ version: "v4", auth: client });

    const rows = await googleSheets.spreadsheets.values.get({
      auth,
      spreadsheetId: actualSpreadsheetId,
      range: `${sheetName}!A:ZZ`,
    });

    console.log("rows", rows);

    if (rows.data.values && rows.data.values.length > 0) {
      // Extract headers from the first row
      const headers = rows.data.values[0];

      // Update the sheet with title_array (headers)
      const { error: updateError } = await supabase
        .from("sheet")
        .update({ title_array: headers })
        .eq("id", sheetResult.id);

      if (updateError) {
        throw updateError;
      }

      // Process the remaining rows (ignoring the header)
      for (let i = 1; i < rows.data.values.length; i++) {
        const rowData = {};
        for (let j = 0; j < rows.data.values[i].length; j++) {
          // Use header if available, fallback to col_{index}
          const colName = headers[j] || `col_${j + 1}`;
          rowData[colName] = rows.data.values[i][j];
        }
        console.log("rowData", rowData);
        await initialRowInsert({
          sheetId: sheetResult.id,
          rowNo: i,
          data: rowData,
          userEmail: "example@example.com",
          userRole: "example",
          localTimestamp: new Date().toISOString(),
        });
      }
    }
  }

  return { sheetResult, isNew: !existingSheet };
}

async function processRow(rowData) {
  const {
    sheetId,
    startRow,
    endRow,
    spreadsheetId,
    sheetName,
    userEmail,
    userRole,
    localTimestamp,
  } = rowData;

  if (
    !sheetId ||
    !spreadsheetId ||
    !sheetName ||
    startRow === undefined ||
    endRow === undefined
  ) {
    throw new Error(
      "Sheet ID, spreadsheet ID, sheet name, start row, and end row are required."
    );
  }

  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.VERCEL_GOOGLE_APPLICATION_CREDENTIALS),
    scopes: "https://www.googleapis.com/auth/spreadsheets",
  });

  const client = await auth.getClient();
  const googleSheets = google.sheets({ version: "v4", auth: client });

  const range = `${sheetName}!A:ZZ`;
  const rows = await googleSheets.spreadsheets.values.get({
    spreadsheetId,
    range: range,
  });

  console.log("rows ->", rows);

  let rowsChanged = [];
  let prevData = [];
  let newData = [];
  let operations = [];

  // Fetch the headers (title_array) for the given sheet
  const { data: sheetData, error: sheetError } = await supabase
    .from("sheet")
    .select("title_array")
    .eq("id", sheetId)
    .single();

  if (sheetError) {
    throw sheetError;
  }

  const headers = sheetData?.title_array || [];

  // Traverse only the rows between startRow and endRow
  for (let i = startRow - 1; i < endRow; i++) {
    const rowData = rows.data.values[i];
    const rowNo = i + 1;
    if (!rowData) continue;

    // Check if the row already exists
    const { data: existingRow, error: selectError } = await supabase
      .from("row")
      .select("*")
      .eq("sheet_id", sheetId)
      .eq("row_no", rowNo)
      .single();

    if (selectError && selectError.code !== "PGRST116") {
      throw selectError;
    }

    const newRowData = {};
    for (let j = 0; j < rowData.length; j++) {
      const colName = headers[j] || `col_${j + 1}`;
      newRowData[colName] = rowData[j];
    }

    let operation;
    if (existingRow) {
      // Check if data has changed
      const existingData = existingRow.data;
      const dataKeys = new Set([
        ...Object.keys(existingData),
        ...Object.keys(newRowData),
      ]);

      let hasChanges = false;
      dataKeys.forEach((key) => {
        if (existingData[key] !== newRowData[key]) {
          hasChanges = true;
        }
      });

      if (hasChanges) {
        if (Object.keys(newRowData).length === 0) {
          // Row data is empty, delete the row
          const { error: deleteError } = await supabase
            .from("row")
            .delete()
            .eq("id", existingRow.id);

          if (deleteError) throw deleteError;

          operation = "delete";
        } else {
          // Update the row
          const { error: updateError } = await supabase
            .from("row")
            .update({ data: newRowData })
            .eq("id", existingRow.id);

          if (updateError) throw updateError;

          operation = "update";
        }
        rowsChanged.push(rowNo);
        prevData.push(existingRow.data);
        newData.push(newRowData);
      } else {
        operation = "no-change";
      }
    } else {
      // Insert new row
      const { error: insertError } = await supabase
        .from("row")
        .insert([{ sheet_id: sheetId, row_no: rowNo, data: newRowData }]);

      if (insertError) throw insertError;

      operation = "insert";
      rowsChanged.push(rowNo);
      prevData.push(null);
      newData.push(newRowData);
    }

    operations.push(operation);
  }

  // Create log payload
  const logPayload = createLogPayload(
    sheetId,
    rowsChanged,
    prevData,
    newData,
    userEmail,
    userRole,
    operations,
    localTimestamp
  );

  return { rowsChanged, prevData, newData, operations, logPayload };
}

async function initialRowInsert(rowData) {
  const { sheetId, rowNo, data, userEmail, userRole, localTimestamp } = rowData;

  if (sheetId === undefined || rowNo === undefined || data === undefined) {
    throw new Error(
      "Sheet ID, row number, data, user email, user role, and local timestamp are required."
    );
  }

  // Fetch the headers (title_array) for the given sheet
  const { data: sheetData, error: sheetError } = await supabase
    .from("sheet")
    .select("title_array")
    .eq("id", sheetId)
    .single();

  if (sheetError) {
    throw sheetError;
  }

  const headers = sheetData?.title_array || [];

  // Map incoming row data to headers
  const rowDataWithHeaders = {};
  Object.keys(data).forEach((key, index) => {
    const headerName = headers[index] || `col_${index + 1}`;
    rowDataWithHeaders[headerName] = data[key];
  });

  // Check if the row already exists
  const { data: existingRow, error: selectError } = await supabase
    .from("row")
    .select("*")
    .eq("sheet_id", sheetId)
    .eq("row_no", rowNo)
    .single();

  let operation;
  let oldRow = existingRow;
  let newRow = null;

  if (selectError && selectError.code !== "PGRST116") {
    throw selectError;
  }

  if (existingRow) {
    console.log("existingRow", existingRow);

    // Check if the existing row's data is equivalent to the incoming data
    const existingData = existingRow.data;
    const dataKeys = new Set([
      ...Object.keys(existingData),
      ...Object.keys(rowDataWithHeaders),
    ]);

    let hasChanges = false;
    dataKeys.forEach((key) => {
      if (existingData[key] !== rowDataWithHeaders[key]) {
        hasChanges = true;
      }
    });

    if (!hasChanges) {
      operation = "no-change";
      oldRow = existingRow;
      newRow = existingRow;
    } else if (Object.keys(rowDataWithHeaders).length === 0) {
      // Row data is empty, delete the row
      const { data: deletedRow, error: deleteError } = await supabase
        .from("row")
        .delete()
        .eq("id", existingRow.id)
        .single();

      if (deleteError) {
        throw deleteError;
      }

      operation = "delete";
      oldRow = existingRow;
      newRow = null;
    } else {
      // Update the row
      const { error: updateError } = await supabase
        .from("row")
        .update({ data: rowDataWithHeaders })
        .eq("id", existingRow.id);

      if (updateError) {
        throw updateError;
      }

      const { data: updatedRow, error: fetchError } = await supabase
        .from("row")
        .select("*")
        .eq("id", existingRow.id)
        .single();

      if (fetchError) {
        throw fetchError;
      }

      console.log("updatedRow", updatedRow);

      operation = "update";
      oldRow = existingRow;
      newRow = updatedRow;
    }
  } else {
    // Insert new row
    const { error: insertError } = await supabase
      .from("row")
      .insert([{ sheet_id: sheetId, row_no: rowNo, data: rowDataWithHeaders }])
      .single();

    if (insertError) {
      throw insertError;
    }

    const { data: insertedRow } = await supabase
      .from("row")
      .select("*")
      .eq("sheet_id", sheetId)
      .eq("row_no", rowNo)
      .single();

    console.log("insertedRow", insertedRow);

    operation = "insert";
    oldRow = null;
    newRow = insertedRow;
  }

  // Create log payload
  const logPayload = createLogPayload(
    sheetId,
    rowNo,
    oldRow ? oldRow.data : null,
    newRow ? newRow.data : null,
    userEmail,
    userRole,
    operation,
    localTimestamp
  );

  oldRow = oldRow ? oldRow.data : null;
  newRow = newRow ? newRow.data : null;

  return { oldRow, newRow, operation, logPayload };
}

// Handler functions

const handleSpreadsheet = async (req, res, next) => {
  const { spreadsheetId } = req.body;

  if (!spreadsheetId) {
    return res.status(400).send({ message: "Spreadsheet ID is required." });
  }

  try {
    const { spreadsheetData, isNew } = await processSpreadsheet(spreadsheetId);
    return res.status(isNew ? 201 : 200).json(spreadsheetData);
  } catch (error) {
    console.error("Error handling spreadsheet:", error);
    res.status(500).send("Failed to handle spreadsheet.");
  }
};

const handleSheet = async (req, res, next) => {
  const { spreadsheetId, sheetId, sheetName, actualSpreadsheetId } = req.body;

  try {
    const { sheetResult, isNew } = await processSheet({
      spreadsheetId,
      sheetId,
      sheetName,
      actualSpreadsheetId,
    });
    return res.status(isNew ? 201 : 200).json(sheetResult);
  } catch (error) {
    console.error("Error handling sheet:", error);
    res.status(500).send("Failed to handle sheet.");
  }
};

const handleRow = async (req, res, next) => {
  try {
    const { rowsChanged, prevData, newData, operations, logPayload } =
      await processRow(req.body);

    // Send log payload
    const logChangeUrl = `${req.protocol}://${req.get("host")}/api/log-change`;
    await fetch(logChangeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(logPayload),
    });

    // Return the row data
    return res.status(200).json({
      rowsChanged,
      prev: prevData,
      new: newData,
      operations,
    });
  } catch (error) {
    console.error("Error handling row:", error);
    res.status(500).send("Failed to handle row.");
  }
};

const createLogPayload = (
  sheetId,
  rowNo,
  prevData,
  newData,
  userEmail,
  userRole,
  operation,
  localTimestamp
) => {
  return {
    sheet_id: sheetId,
    rows_changed: [rowNo],
    prev_data: [prevData],
    new_data: [newData],
    user_email: userEmail,
    user_role: userRole || null,
    change_type: operation,
    local_timestamp: localTimestamp,
    created_at: new Date().toISOString(),
  };
};

module.exports = { handleSpreadsheet, handleSheet, handleRow };

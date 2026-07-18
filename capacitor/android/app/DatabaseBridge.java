package net.hampoelz.capacitor.nodejs;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.util.Log;

import com.getcapacitor.JSArray;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;

public class DatabaseBridge {
    private static final String TAG = "DatabaseBridge";
    private static final String EVENT_CHANNEL = "EVENT_CHANNEL";
    private static DatabaseBridge instance;
    public interface BridgeSender {
        void send(String channelName, String message);
    }
    private SQLiteDatabase mainDb;
    private SQLiteDatabase mappingDb;
    private String dataDir;
    private BridgeSender bridgeSender;

    private DatabaseBridge() {}

    public static synchronized DatabaseBridge getInstance() {
        if (instance == null) {
            instance = new DatabaseBridge();
        }
        return instance;
    }

    public void handleRequest(Context context, String eventName, JSArray args, BridgeSender sender) {
        this.bridgeSender = sender;

        int requestId = -1;
        try {
            JSONObject request = args.getJSONObject(0);
            requestId = request.getInt("requestId");

            switch (eventName) {
                case "db-init":
                    handleInit(context, requestId, request);
                    break;
                case "db-exec":
                    handleExec(requestId, request);
                    break;
                case "db-run":
                    handleRun(requestId, request);
                    break;
                case "db-query-all":
                    handleQueryAll(requestId, request);
                    break;
                case "db-query-one":
                    handleQueryOne(requestId, request);
                    break;
                case "db-pragma":
                    handlePragma(requestId, request);
                    break;
                case "db-close":
                    handleClose(requestId, request);
                    break;
                case "db-open":
                    handleOpen(requestId, request);
                    break;
                case "db-batch-run":
                    handleBatchRun(requestId, request);
                    break;
                default:
                    sendError(requestId, "Unknown db event: " + eventName);
            }
        } catch (Exception e) {
            Log.e(TAG, "Error handling db request '" + eventName + "': " + e.getMessage(), e);
            if (requestId != -1) {
                sendError(requestId, e.getMessage());
            }
        }
    }

    private void handleInit(Context context, int requestId, JSONObject request) throws JSONException {
        String baseDir = request.getString("dataDir");
        File strawverseRoot = new File(baseDir);
        File dataFolder = new File(strawverseRoot, "data");
        dataFolder.mkdirs();

        dataDir = dataFolder.getAbsolutePath();

        openDatabaseInternal("main");
        openDatabaseInternal("mapping");

        JSONObject result = new JSONObject();
        result.put("ok", true);
        sendResult(requestId, result);
    }

    private void handleExec(int requestId, JSONObject request) throws JSONException {
        SQLiteDatabase db = getDb(request.getString("db"));
        String sql = request.getString("sql");

        String[] statements = sql.split(";");
        for (String stmt : statements) {
            String trimmed = stmt.trim();
            if (!trimmed.isEmpty()) {
                db.execSQL(trimmed);
            }
        }

        JSONObject result = new JSONObject();
        result.put("ok", true);
        sendResult(requestId, result);
    }

    private void handleRun(int requestId, JSONObject request) throws JSONException {
        SQLiteDatabase db = getDb(request.getString("db"));
        String sql = request.getString("sql");
        JSONArray params = request.optJSONArray("params");

        Object[] bindArgs = jsonArrayToObjectArray(params);

        if (bindArgs.length > 0) {
            db.execSQL(sql, bindArgs);
        } else {
            db.execSQL(sql);
        }

        long changes = 0;
        long lastInsertRowid = 0;
        Cursor c = null;
        try {
            c = db.rawQuery("SELECT changes() AS c, last_insert_rowid() AS r", null);
            if (c.moveToFirst()) {
                changes = c.getLong(0);
                lastInsertRowid = c.getLong(1);
            }
        } finally {
            if (c != null) c.close();
        }

        JSONObject result = new JSONObject();
        result.put("changes", changes);
        result.put("lastInsertRowid", lastInsertRowid);
        sendResult(requestId, result);
    }

    private void handleQueryAll(int requestId, JSONObject request) throws JSONException {
        SQLiteDatabase db = getDb(request.getString("db"));
        String sql = request.getString("sql");
        JSONArray params = request.optJSONArray("params");

        String[] selectionArgs = jsonArrayToStringArray(params);

        Cursor cursor = null;
        try {
            cursor = db.rawQuery(sql, selectionArgs.length > 0 ? selectionArgs : null);
            JSONArray rows = cursorToJsonArray(cursor);

            JSONObject result = new JSONObject();
            result.put("rows", rows);
            sendResult(requestId, result);
        } finally {
            if (cursor != null) cursor.close();
        }
    }

    private void handleQueryOne(int requestId, JSONObject request) throws JSONException {
        SQLiteDatabase db = getDb(request.getString("db"));
        String sql = request.getString("sql");
        JSONArray params = request.optJSONArray("params");

        String[] selectionArgs = jsonArrayToStringArray(params);

        Cursor cursor = null;
        try {
            cursor = db.rawQuery(sql, selectionArgs.length > 0 ? selectionArgs : null);
            JSONObject result = new JSONObject();

            if (cursor.moveToFirst()) {
                result.put("row", cursorRowToJson(cursor));
            } else {
                result.put("row", JSONObject.NULL);
            }
            sendResult(requestId, result);
        } finally {
            if (cursor != null) cursor.close();
        }
    }

    private void handlePragma(int requestId, JSONObject request) throws JSONException {
        SQLiteDatabase db = getDb(request.getString("db"));
        String pragma = request.getString("sql");

        if (pragma.contains("=")) {
            db.execSQL("PRAGMA " + pragma);
            JSONObject result = new JSONObject();
            result.put("ok", true);
            sendResult(requestId, result);
        } else {
            Cursor cursor = null;
            try {
                cursor = db.rawQuery("PRAGMA " + pragma, null);
                JSONObject result = new JSONObject();
                if (cursor.moveToFirst()) {
                    result.put("value", cursor.getString(0));
                }
                sendResult(requestId, result);
            } finally {
                if (cursor != null) cursor.close();
            }
        }
    }

    private void handleClose(int requestId, JSONObject request) throws JSONException {
        String dbName = request.getString("db");
        closeDatabaseInternal(dbName);

        JSONObject result = new JSONObject();
        result.put("ok", true);
        sendResult(requestId, result);
    }

    private void handleOpen(int requestId, JSONObject request) throws JSONException {
        String dbName = request.getString("db");
        openDatabaseInternal(dbName);

        JSONObject result = new JSONObject();
        result.put("ok", true);
        sendResult(requestId, result);
    }

    private void handleBatchRun(int requestId, JSONObject request) throws JSONException {
        SQLiteDatabase db = getDb(request.getString("db"));
        JSONArray operations = request.getJSONArray("operations");

        long totalChanges = 0;

        db.beginTransaction();
        try {
            for (int i = 0; i < operations.length(); i++) {
                JSONObject op = operations.getJSONObject(i);
                String sql = op.getString("sql");
                JSONArray params = op.optJSONArray("params");
                Object[] bindArgs = jsonArrayToObjectArray(params);

                if (bindArgs.length > 0) {
                    db.execSQL(sql, bindArgs);
                } else {
                    db.execSQL(sql);
                }
            }
            db.setTransactionSuccessful();

            Cursor c = null;
            try {
                c = db.rawQuery("SELECT total_changes()", null);
                if (c.moveToFirst()) {
                    totalChanges = c.getLong(0);
                }
            } finally {
                if (c != null) c.close();
            }
        } finally {
            db.endTransaction();
        }

        JSONObject result = new JSONObject();
        result.put("totalChanges", totalChanges);
        result.put("ok", true);
        sendResult(requestId, result);
    }

    private SQLiteDatabase getDb(String dbName) {
        SQLiteDatabase db = dbName.equals("mapping") ? mappingDb : mainDb;
        if (db == null || !db.isOpen()) {
            throw new IllegalStateException("Database '" + dbName + "' is not open. Call db-init first.");
        }
        return db;
    }

    private void openDatabaseInternal(String dbName) {
        closeDatabaseInternal(dbName);

        String filename = dbName.equals("mapping") ? "mapping.db" : "database.db";
        File dbFile = new File(dataDir, filename);

        try {
            SQLiteDatabase db = SQLiteDatabase.openOrCreateDatabase(dbFile, null);
            db.enableWriteAheadLogging();

            if (dbName.equals("mapping")) {
                mappingDb = db;
            } else {
                mainDb = db;
                try {
                    Class<?> appDbClass = Class.forName("app.strawverse.android.AppDatabase");
                    java.lang.reflect.Method method = appDbClass.getMethod("setDatabaseFile", File.class);
                    method.invoke(null, dbFile);
                    Log.i(TAG, "Called AppDatabase.setDatabaseFile via reflection");
                } catch (Exception re) {
                    Log.e(TAG, "Failed to update AppDatabase via reflection: " + re.getMessage());
                }
            }

            Log.i(TAG, "Opened " + filename + " at " + dbFile.getAbsolutePath());
        } catch (Exception e) {
            Log.e(TAG, "Failed to open " + filename + ": " + e.getMessage(), e);
            throw new RuntimeException("Failed to open database '" + dbName + "': " + e.getMessage());
        }
    }

    private void closeDatabaseInternal(String dbName) {
        try {
            if (dbName.equals("mapping")) {
                if (mappingDb != null && mappingDb.isOpen()) {
                    mappingDb.close();
                    mappingDb = null;
                }
            } else {
                if (mainDb != null && mainDb.isOpen()) {
                    mainDb.close();
                    mainDb = null;
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Error closing " + dbName + " database: " + e.getMessage());
        }
    }

    private void sendResult(int requestId, JSONObject result) {
        try {
            JSONObject response = new JSONObject();
            response.put("requestId", requestId);
            response.put("result", result);
            sendToNode("db-response", response);
        } catch (JSONException e) {
            Log.e(TAG, "Failed to send result: " + e.getMessage());
        }
    }

    private void sendError(int requestId, String error) {
        try {
            JSONObject response = new JSONObject();
            response.put("requestId", requestId);
            response.put("error", error != null ? error : "Unknown error");
            sendToNode("db-response", response);
        } catch (JSONException e) {
            Log.e(TAG, "Failed to send error response: " + e.getMessage());
        }
    }

    public void sendEventToNode(String eventName, JSONObject data) {
        sendToNode(eventName, data);
    }

    private void sendToNode(String eventName, JSONObject data) {
        if (bridgeSender == null) {
            Log.e(TAG, "Cannot send to Node.js: bridgeSender is null");
            return;
        }
        try {
            JSONArray argsArray = new JSONArray();
            argsArray.put(data);

            JSONObject message = new JSONObject();
            message.put("eventName", eventName);
            message.put("eventMessage", argsArray.toString());

            bridgeSender.send(EVENT_CHANNEL, message.toString());
        } catch (JSONException e) {
            Log.e(TAG, "Failed to serialize response: " + e.getMessage());
        }
    }

    private static Object[] jsonArrayToObjectArray(JSONArray arr) {
        if (arr == null || arr.length() == 0) return new Object[0];
        Object[] result = new Object[arr.length()];
        for (int i = 0; i < arr.length(); i++) {
            Object val = arr.opt(i);
            if (val == null || val == JSONObject.NULL) {
                result[i] = null;
            } else if (val instanceof Number) {
                Number num = (Number) val;
                if (num.doubleValue() == num.longValue()) {
                    result[i] = num.longValue();
                } else {
                    result[i] = num.doubleValue();
                }
            } else {
                result[i] = val.toString();
            }
        }
        return result;
    }

    private static String[] jsonArrayToStringArray(JSONArray arr) {
        if (arr == null || arr.length() == 0) return new String[0];
        String[] result = new String[arr.length()];
        for (int i = 0; i < arr.length(); i++) {
            Object val = arr.opt(i);
            if (val == null || val == JSONObject.NULL) {
                result[i] = null;
            } else {
                result[i] = val.toString();
            }
        }
        return result;
    }

    private static JSONArray cursorToJsonArray(Cursor cursor) throws JSONException {
        JSONArray rows = new JSONArray();
        String[] columnNames = cursor.getColumnNames();
        while (cursor.moveToNext()) {
            rows.put(cursorRowToJson(cursor, columnNames));
        }
        return rows;
    }

    private static JSONObject cursorRowToJson(Cursor cursor) throws JSONException {
        return cursorRowToJson(cursor, cursor.getColumnNames());
    }

    private static JSONObject cursorRowToJson(Cursor cursor, String[] columnNames) throws JSONException {
        JSONObject row = new JSONObject();
        for (int i = 0; i < columnNames.length; i++) {
            int type = cursor.getType(i);
            switch (type) {
                case Cursor.FIELD_TYPE_NULL:
                    row.put(columnNames[i], JSONObject.NULL);
                    break;
                case Cursor.FIELD_TYPE_INTEGER:
                    row.put(columnNames[i], cursor.getLong(i));
                    break;
                case Cursor.FIELD_TYPE_FLOAT:
                    row.put(columnNames[i], cursor.getDouble(i));
                    break;
                case Cursor.FIELD_TYPE_STRING:
                    row.put(columnNames[i], cursor.getString(i));
                    break;
                case Cursor.FIELD_TYPE_BLOB:
                    row.put(columnNames[i], android.util.Base64.encodeToString(
                            cursor.getBlob(i), android.util.Base64.NO_WRAP));
                    break;
            }
        }
        return row;
    }
}

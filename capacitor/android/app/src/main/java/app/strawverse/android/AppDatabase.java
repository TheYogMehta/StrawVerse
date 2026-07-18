package app.strawverse.android;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.net.Uri;
import android.util.Log;
import java.io.File;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public class AppDatabase {
    private static final String TAG = "AppDatabase";
    private static SQLiteDatabase instance = null;
    private static File dbFile = null;

    public static synchronized void setDatabaseFile(File file) {
        if (instance != null && instance.isOpen()) {
            try { instance.close(); } catch (Exception ignored) {}
            instance = null;
        }
        dbFile = file;
    }

    private static File findDatabaseFile(File dir) {
        if (dir == null || !dir.exists()) return null;
        File[] files = dir.listFiles();
        if (files == null) return null;
        for (File file : files) {
            if (file.isDirectory()) {
                File found = findDatabaseFile(file);
                if (found != null) return found;
            } else if (file.getName().equals("database.db")) {
                return file;
            }
        }
        return null;
    }

    private static synchronized SQLiteDatabase getDatabase(Context context) {
        if (instance != null && instance.isOpen()) {
            return instance;
        }
        if (dbFile == null) {
            dbFile = findDatabaseFile(context.getFilesDir());
        }
        if (dbFile == null) {
            return null;
        }
        try {
            instance = SQLiteDatabase.openDatabase(
                dbFile.getAbsolutePath(),
                null,
                SQLiteDatabase.OPEN_READONLY | SQLiteDatabase.NO_LOCALIZED_COLLATORS
            );
        } catch (Exception e) {
            Log.e(TAG, "Failed to open database: " + e.getMessage());
        }
        return instance;
    }

    public static String getStoredReferer(Context context, String url) {
        SQLiteDatabase db = getDatabase(context);
        if (db == null) return null;
        Cursor cursor = null;
        try {
            Uri uri = Uri.parse(url);
            String domain = uri.getHost();
            if (domain != null) {
                domain = domain.replace("www.", "").toLowerCase();
                cursor = db.rawQuery(
                    "SELECT referer FROM StreamReferer WHERE domain = ? LIMIT 1",
                    new String[]{domain}
                );
                if (cursor.moveToFirst()) {
                    return cursor.getString(0);
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to query database for referer: " + e.getMessage());
        } finally {
            if (cursor != null) cursor.close();
        }
        return null;
    }

    public static String getStoredCfClearanceCookie(Context context, String url) {
        SQLiteDatabase db = getDatabase(context);
        if (db == null) return null;
        Cursor cursor = null;
        try {
            Uri uri = Uri.parse(url);
            String domain = uri.getHost();
            if (domain != null) {
                domain = domain.replace("www.", "").toLowerCase();
                if (domain.endsWith("animepahe.pw")) {
                    domain = "animepahe.pw";
                } else if (domain.contains("kwik.cx") || domain.contains("owocdn.top") || domain.contains("uwucdn.top")) {
                    domain = "kwik.cx";
                }
                cursor = db.rawQuery(
                    "SELECT value FROM cookie WHERE (id = ? OR (name = 'cf_clearance' AND (LTRIM(?, '.') = LTRIM(domain, '.') OR LTRIM(?, '.') LIKE '%.' || LTRIM(domain, '.')))) ORDER BY CAST(expirationDate AS REAL) DESC LIMIT 1",
                    new String[]{domain + "-cf_clearance", domain, domain}
                );
                if (cursor.moveToFirst()) {
                    return cursor.getString(0);
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to query database for cf_clearance: " + e.getMessage());
        } finally {
            if (cursor != null) cursor.close();
        }
        return null;
    }

    public static String getStoredUserAgent(Context context, String url) {
        SQLiteDatabase db = getDatabase(context);
        if (db == null) return null;
        Cursor cursor = null;
        try {
            Uri uri = Uri.parse(url);
            String domain = uri.getHost();
            if (domain != null) {
                domain = domain.replace("www.", "").toLowerCase();
                if (domain.endsWith("animepahe.pw")) {
                    domain = "animepahe.pw";
                } else if (domain.contains("kwik.cx") || domain.contains("owocdn.top") || domain.contains("uwucdn.top")) {
                    domain = "kwik.cx";
                }
                cursor = db.rawQuery(
                    "SELECT value FROM cookie WHERE id = ? LIMIT 1",
                    new String[]{domain + "-user_agent"}
                );
                if (cursor.moveToFirst()) {
                    return cursor.getString(0);
                }

                String[] parts = domain.split("\\.");
                if (parts.length >= 2) {
                    String mainDomain = parts[parts.length - 2] + "." + parts[parts.length - 1];
                    if (cursor != null) cursor.close();
                    cursor = db.rawQuery(
                        "SELECT value FROM cookie WHERE id = ? LIMIT 1",
                        new String[]{mainDomain + "-user_agent"}
                    );
                    if (cursor.moveToFirst()) {
                        return cursor.getString(0);
                    }
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to query database for user_agent: " + e.getMessage());
        } finally {
            if (cursor != null) cursor.close();
        }
        return null;
    }

    public static Map<String, String> getHeadersForUrl(Context context, String url) {
        Map<String, String> headers = new HashMap<>();
        if (url == null) return headers;

        // Static rules
        if (url.contains("owocdn.top") || url.contains("uwucdn.top")) {
            headers.put("Referer", "https://kwik.cx/");
        } else if (url.contains("kwik.cx")) {
            headers.put("Referer", "https://animepahe.pw/");
        } else if (url.contains("animepahe")) {
            headers.put("Referer", "https://animepahe.pw/");
        } else if (url.contains("temp.compsci88.com")) {
            headers.put("Referer", "https://weebcentral.com/");
        } else if (url.contains("anikototv.to") || url.contains("megaplay.buzz")) {
            headers.put("Referer", "https://anikototv.to/");
        } else if (url.contains("allmanga.to") || url.contains("allanime.day") || url.contains("youtube-anime.com")) {
            headers.put("Referer", "https://allmanga.to/");
        }

        // Dynamic referer from database
        if (!headers.containsKey("Referer")) {
            String dbReferer = getStoredReferer(context, url);
            if (dbReferer != null && !dbReferer.isEmpty()) {
                headers.put("Referer", dbReferer);
            }
        }

        // Dynamic cf_clearance cookie from database
        String cfCookie = getStoredCfClearanceCookie(context, url);
        if (cfCookie != null && !cfCookie.isEmpty()) {
            headers.put("Cookie", "cf_clearance=" + cfCookie + ";");
        }

        // Dynamic user_agent from database
        String ua = getStoredUserAgent(context, url);
        if (ua != null && !ua.isEmpty()) {
            headers.put("User-Agent", ua);
        }

        return headers;
    }

    public static String mergeCookies(String explicitCookies, String browserCookies) {
        Map<String, String> map = new LinkedHashMap<>();
        if (browserCookies != null) {
            for (String pair : browserCookies.split(";")) {
                int idx = pair.indexOf("=");
                if (idx != -1) {
                    map.put(pair.substring(0, idx).trim(), pair.substring(idx + 1).trim());
                }
            }
        }
        if (explicitCookies != null) {
            for (String pair : explicitCookies.split(";")) {
                int idx = pair.indexOf("=");
                if (idx != -1) {
                    map.put(pair.substring(0, idx).trim(), pair.substring(idx + 1).trim());
                }
            }
        }
        StringBuilder sb = new StringBuilder();
        for (Map.Entry<String, String> entry : map.entrySet()) {
            if (sb.length() > 0) sb.append("; ");
            sb.append(entry.getKey()).append("=").append(entry.getValue());
        }
        return sb.toString();
    }

    public static String cookieNames(String cookieHeader) {
        if (cookieHeader == null) return "";
        List<String> names = new java.util.ArrayList<>();
        for (String pair : cookieHeader.split(";")) {
            int idx = pair.indexOf("=");
            if (idx != -1) {
                names.add(pair.substring(0, idx).trim());
            }
        }
        return String.join(", ", names);
    }
}

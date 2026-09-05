package com.mianji.sleep;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.view.WindowManager;

import androidx.core.content.FileProvider;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

public class MainActivity extends BridgeActivity {

    @CapacitorPlugin(name = "SleepWidgetBridge")
    public static class SleepWidgetBridgePlugin extends Plugin {
        private static final String NOTIFICATION_CHANNEL_ID = "mianji_sleep_tracking";
        private static final int NOTIFICATION_ID = 1001;
        public static volatile String pendingAction = null;

        private static void createNotificationChannel(Context context) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
                if (nm != null) {
                    NotificationChannel channel = new NotificationChannel(
                        NOTIFICATION_CHANNEL_ID,
                        "睡眠记录与锁屏状态",
                        NotificationManager.IMPORTANCE_DEFAULT
                    );
                    channel.setDescription("在锁屏界面与通知栏常驻显示当前睡眠记录时长与状态");
                    channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
                    channel.setShowBadge(true);
                    channel.enableVibration(false);
                    channel.setSound(null, null);
                    nm.createNotificationChannel(channel);
                }
            }
        }

        private static void updateSleepNotification(Context context, String state, String headline, String subline, String actionText, long startTimeMs) {
            NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            createNotificationChannel(context);

            if (!"active".equals(state)) {
                nm.cancel(NOTIFICATION_ID);
                return;
            }

            Intent mainIntent = new Intent(context, MainActivity.class);
            mainIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent mainPendingIntent = PendingIntent.getActivity(
                context,
                0,
                mainIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
            );

            Intent wakeIntent = new Intent(context, MainActivity.class);
            wakeIntent.setAction("com.mianji.sleep.ACTION_WAKE");
            wakeIntent.putExtra("shortcutAction", "wake");
            wakeIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent wakePendingIntent = PendingIntent.getActivity(
                context,
                1003,
                wakeIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
            );

            androidx.core.app.NotificationCompat.Builder builder = new androidx.core.app.NotificationCompat.Builder(context, NOTIFICATION_CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle("🌙 " + headline)
                .setContentText(subline)
                .setSubText("眠记 · 锁屏睡眠记录中")
                .setOngoing(true)
                .setAutoCancel(false)
                .setPriority(androidx.core.app.NotificationCompat.PRIORITY_DEFAULT)
                .setVisibility(androidx.core.app.NotificationCompat.VISIBILITY_PUBLIC)
                .setContentIntent(mainPendingIntent)
                .addAction(R.mipmap.ic_launcher, "☀️ 我醒了 / 起床", wakePendingIntent);

            if (startTimeMs > 0) {
                builder.setWhen(startTimeMs);
                builder.setUsesChronometer(true);
                builder.setShowWhen(true);
            }

            nm.notify(NOTIFICATION_ID, builder.build());
        }

        @PluginMethod
        public void updateWidgetState(PluginCall call) {
            String state = call.getString("state", "idle");
            String headline = call.getString("headline", "");
            String subline = call.getString("subline", "");
            String actionText = call.getString("actionText", "");
            long startTimeMs = 0L;
            Double startTimeMsVal = call.getDouble("startTimeMs");
            if (startTimeMsVal != null) {
                startTimeMs = startTimeMsVal.longValue();
            }

            Context context = getContext();
            if (context != null) {
                SharedPreferences prefs = context.getSharedPreferences(SleepWidgetProvider.PREFS_NAME, Context.MODE_PRIVATE);
                prefs.edit()
                    .putString(SleepWidgetProvider.KEY_HEADLINE, headline)
                    .putString(SleepWidgetProvider.KEY_SUBLINE, subline)
                    .putString(SleepWidgetProvider.KEY_ACTION_TEXT, actionText)
                    .apply();

                AppWidgetManager appWidgetManager = AppWidgetManager.getInstance(context);
                ComponentName component = new ComponentName(context, SleepWidgetProvider.class);
                int[] ids = appWidgetManager.getAppWidgetIds(component);
                if (ids != null && ids.length > 0) {
                    for (int id : ids) {
                        SleepWidgetProvider.updateAppWidget(context, appWidgetManager, id);
                    }
                }

                updateSleepNotification(context, state, headline, subline, actionText, startTimeMs);
            }
            call.resolve();
        }

        @PluginMethod
        public void consumePendingAction(PluginCall call) {
            JSObject ret = new JSObject();
            ret.put("action", pendingAction);
            pendingAction = null;
            call.resolve(ret);
        }

        @PluginMethod
        public void openAppSettings(PluginCall call) {
            Context context = getContext();
            if (context != null) {
                Intent intent = new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                intent.setData(Uri.parse("package:" + context.getPackageName()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(intent);
            }
            call.resolve();
        }

        @PluginMethod
        public void exportFile(PluginCall call) {
            String content = call.getString("content", "");
            String filename = call.getString("filename", "mianji-backup.json");
            String mimeType = call.getString("mimeType", "application/json");
            String title = call.getString("title", "分享或保存备份");

            Context context = getContext();
            if (context == null) {
                call.reject("Context is null");
                return;
            }

            String savedPath = null;
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.MediaColumns.DISPLAY_NAME, filename);
                    values.put(MediaStore.MediaColumns.MIME_TYPE, mimeType);
                    values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/眠记");
                    ContentResolver resolver = context.getContentResolver();
                    Uri downloadUri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (downloadUri != null) {
                        try (OutputStream os = resolver.openOutputStream(downloadUri)) {
                            if (os != null) {
                                os.write(content.getBytes(StandardCharsets.UTF_8));
                                savedPath = "手机存储/Download/眠记/" + filename;
                            }
                        }
                    }
                } else {
                    File downloadDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                    File mianjiDir = new File(downloadDir, "眠记");
                    if (!mianjiDir.exists()) {
                        mianjiDir.mkdirs();
                    }
                    File destFile = new File(mianjiDir, filename);
                    try (FileOutputStream fos = new FileOutputStream(destFile)) {
                        fos.write(content.getBytes(StandardCharsets.UTF_8));
                        savedPath = destFile.getAbsolutePath();
                    }
                }
            } catch (Exception ignored) {
            }

            try {
                File cachePath = new File(context.getCacheDir(), "exports");
                if (!cachePath.exists()) {
                    cachePath.mkdirs();
                }
                File shareFile = new File(cachePath, filename);
                try (FileOutputStream fos = new FileOutputStream(shareFile)) {
                    fos.write(content.getBytes(StandardCharsets.UTF_8));
                }

                Uri contentUri = FileProvider.getUriForFile(
                    context,
                    context.getPackageName() + ".fileprovider",
                    shareFile
                );

                Intent shareIntent = new Intent(Intent.ACTION_SEND);
                shareIntent.setType(mimeType);
                shareIntent.putExtra(Intent.EXTRA_STREAM, contentUri);
                shareIntent.putExtra(Intent.EXTRA_SUBJECT, title);
                shareIntent.putExtra(Intent.EXTRA_TEXT, "眠记数据备份：" + filename);
                shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

                Intent chooser = Intent.createChooser(shareIntent, title);
                chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

                if (getActivity() != null) {
                    getActivity().runOnUiThread(() -> {
                        try {
                            getActivity().startActivity(chooser);
                        } catch (Exception ex) {
                            context.startActivity(chooser);
                        }
                    });
                } else {
                    context.startActivity(chooser);
                }

                JSObject ret = new JSObject();
                ret.put("success", true);
                ret.put("savedPath", savedPath != null ? savedPath : "系统缓存与分享面板");
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("导出失败: " + e.getMessage());
            }
        }
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SleepWidgetBridgePlugin.class);
        super.onCreate(savedInstanceState);
        applyLockScreenFlags();
        handleIntent(getIntent());
        requestNotificationPermission();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        applyLockScreenFlags();
        handleIntent(intent);
    }

    private void handleIntent(Intent intent) {
        if (intent != null && "wake".equals(intent.getStringExtra("shortcutAction"))) {
            SleepWidgetBridgePlugin.pendingAction = "wake";
        }
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33) {
            if (checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, 1002);
            }
        }
    }

    @Override
    public void onAttachedToWindow() {
        super.onAttachedToWindow();
        applyLockScreenFlags();
    }

    @Override
    public void onResume() {
        super.onResume();
        applyLockScreenFlags();
        handleIntent(getIntent());
    }

    private void applyLockScreenFlags() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        }
        getWindow().addFlags(
            WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
            | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
            | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
            | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
        );
    }
}

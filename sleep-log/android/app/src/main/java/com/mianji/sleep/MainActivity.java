package com.mianji.sleep;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.WebView;
import android.util.Log;


import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.OutputStream;
import java.io.BufferedReader;
import java.io.InputStreamReader;
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

        private volatile boolean exportInProgress = false;

        @PluginMethod
        public void exportFile(PluginCall call) {
            if (exportInProgress) {
                call.reject("另一个导出正在进行，请先完成或取消");
                return;
            }
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType(call.getString("mimeType", "application/json"));
            intent.putExtra(Intent.EXTRA_TITLE, call.getString("filename", "mianji-backup.json"));
            exportInProgress = true;
            try {
                startActivityForResult(call, intent, "saveExportResult");
            } catch (Exception error) {
                exportInProgress = false;
                call.reject("无法打开系统文件保存窗口", error);
            }
        }

        @com.getcapacitor.annotation.ActivityCallback
        private void saveExportResult(PluginCall call, androidx.activity.result.ActivityResult result) {
            if (call == null) {
                exportInProgress = false;
                return;
            }
            if (result.getResultCode() != android.app.Activity.RESULT_OK) {
                exportInProgress = false;
                JSObject ret = new JSObject();
                ret.put("success", false);
                ret.put("cancelled", true);
                call.resolve(ret);
                return;
            }
            Uri uri = result.getData() == null ? null : result.getData().getData();
            if (uri == null) {
                exportInProgress = false;
                call.reject("系统未返回保存位置，请重试");
                return;
            }
            execute(() -> {
                try {
                    // Only the user-selected document is opened. No broad storage permission.
                    try (OutputStream stream = getContext().getContentResolver().openOutputStream(uri, "wt")) {
                        if (stream == null) throw new java.io.IOException("无法写入选择的文件");
                        stream.write(call.getString("content", "").getBytes(StandardCharsets.UTF_8));
                        stream.flush();
                    }
                    JSObject ret = new JSObject();
                    ret.put("success", true);
                    ret.put("savedPath", call.getString("filename", "备份文件"));
                    // Resolve only after the document stream has successfully CLOSED.
                    call.resolve(ret);
                } catch (Exception error) {
                    call.reject("文件未成功保存，请检查存储空间或更换位置后重试", error);
                } finally {
                    exportInProgress = false;
                }
            });
        }
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SleepWidgetBridgePlugin.class);
        bridgeBuilder.addWebViewListener(new WebViewListener() {
            private boolean checked = false;

            @Override
            public void onPageLoaded(WebView view) {
                Uri page = Uri.parse(view.getUrl() == null ? "" : view.getUrl());
                if (checked || !"localhost".equals(page.getHost())) return;
                checked = true;
                try (BufferedReader reader = new BufferedReader(new InputStreamReader(
                        getAssets().open("native-cache-reset.js"), StandardCharsets.UTF_8))) {
                    StringBuilder script = new StringBuilder();
                    String line;
                    while ((line = reader.readLine()) != null) script.append(line).append('\n');
                    view.evaluateJavascript(script.toString(), null);
                } catch (Exception error) {
                    Log.e("Mianji", "Could not recover old app-shell cache", error);
                }
            }
        });
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
            intent.removeExtra("shortcutAction");
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
        Intent currentIntent = getIntent();
        if (currentIntent != null && "wake".equals(currentIntent.getStringExtra("shortcutAction"))) {
            SleepWidgetBridgePlugin.pendingAction = "wake";
            currentIntent.removeExtra("shortcutAction");
        }
    }

    private void applyLockScreenFlags() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        }
        // Removed FLAG_KEEP_SCREEN_ON to prevent battery drain while sleeping!
        getWindow().addFlags(
            WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
            | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
            | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
        );
    }
}

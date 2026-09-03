package com.mianji.sleep;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

public class MainActivity extends BridgeActivity {

    @CapacitorPlugin(name = "SleepWidgetBridge")
    public static class SleepWidgetBridgePlugin extends Plugin {
        @PluginMethod
        public void updateWidgetState(PluginCall call) {
            String headline = call.getString("headline", "");
            String subline = call.getString("subline", "");
            String actionText = call.getString("actionText", "");

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
            }
            call.resolve();
        }
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SleepWidgetBridgePlugin.class);
        super.onCreate(savedInstanceState);

        // 允许预先打开应用时在锁屏状态下直接查看和操作（点亮屏幕无需输密码即可使用）
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(
                android.view.WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                | android.view.WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
                | android.view.WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
            );
        }
    }
}

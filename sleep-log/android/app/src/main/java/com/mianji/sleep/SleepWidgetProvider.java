package com.mianji.sleep;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.widget.RemoteViews;

public class SleepWidgetProvider extends AppWidgetProvider {
    public static final String PREFS_NAME = "mianji_widget_prefs";
    public static final String KEY_HEADLINE = "widget_headline";
    public static final String KEY_SUBLINE = "widget_subline";
    public static final String KEY_ACTION_TEXT = "widget_action_text";

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            updateAppWidget(context, appWidgetManager, appWidgetId);
        }
    }

    public static void updateAppWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String headline = prefs.getString(KEY_HEADLINE, context.getString(R.string.widget_default_headline));
        String subline = prefs.getString(KEY_SUBLINE, context.getString(R.string.widget_default_subline));
        String actionText = prefs.getString(KEY_ACTION_TEXT, context.getString(R.string.widget_default_action));

        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.sleep_widget);
        views.setTextViewText(R.id.widget_headline, headline);
        views.setTextViewText(R.id.widget_subline, subline);
        views.setTextViewText(R.id.widget_action_button, actionText);

        Intent intent = new Intent(context, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            context,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        views.setOnClickPendingIntent(R.id.widget_action_button, pendingIntent);
        views.setOnClickPendingIntent(R.id.widget_headline, pendingIntent);

        appWidgetManager.updateAppWidget(appWidgetId, views);
    }
}

package club.hearthroom.app;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import androidx.test.platform.app.InstrumentationRegistry;
import com.google.androidbrowserhelper.trusted.TwaProviderPicker;
import org.junit.Test;
import static org.junit.Assert.*;

public class NoBrowserLaunchTest {
    @Test public void launcherUsesTheAppWhenNoTwaBrowserIsInstalled() throws Exception {
        Instrumentation instrumentation=InstrumentationRegistry.getInstrumentation();
        assertNotEquals("Disable TWA browsers on the test device first",0,TwaProviderPicker.pickProvider(instrumentation.getTargetContext().getPackageManager()).launchMode);
        // Debug builds are always older than the live release; start without a stored offer or a due background check.
        instrumentation.getTargetContext().getSharedPreferences("routes",android.content.Context.MODE_PRIVATE).edit().clear().putLong("background",System.currentTimeMillis()).commit();
        Instrumentation.ActivityMonitor monitor=instrumentation.addMonitor(WebActivity.class.getName(),null,false);
        try {
            Intent intent=new Intent(instrumentation.getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            instrumentation.getTargetContext().startActivity(intent);
            Activity fallback=monitor.waitForActivityWithTimeout(10000);
            assertNotNull("The launcher must open its own WebView, not an external browser",fallback);
            instrumentation.runOnMainSync(fallback::finish);
        } finally { instrumentation.removeMonitor(monitor); }
    }
}

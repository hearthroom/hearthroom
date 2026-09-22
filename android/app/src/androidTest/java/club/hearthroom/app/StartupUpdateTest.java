package club.hearthroom.app;

import android.app.Activity;
import android.app.Application;
import android.app.Instrumentation;
import android.content.Intent;
import android.os.Bundle;
import android.os.SystemClock;
import android.widget.TextView;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import java.io.IOException;
import java.lang.reflect.Field;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

/** Exercises the real launcher lifecycle; only the update transport is controlled. */
public class StartupUpdateTest {
    private final Instrumentation instrumentation=InstrumentationRegistry.getInstrumentation();
    private final DelayedClient client=new DelayedClient();
    private final AtomicReference<MainActivity> launcher=new AtomicReference<>();
    private Application application;
    private Instrumentation.ActivityMonitor web;
    private final Application.ActivityLifecycleCallbacks callbacks=new Application.ActivityLifecycleCallbacks(){
        @Override public void onActivityPreCreated(Activity activity,Bundle state){
            if(activity instanceof MainActivity){
                try {Field field=MainActivity.class.getDeclaredField("client");field.setAccessible(true);field.set(activity,client);}
                catch(Exception e){throw new AssertionError(e);}
                launcher.set((MainActivity)activity);
            }
        }
        public void onActivityCreated(Activity a,Bundle b){}
        public void onActivityStarted(Activity a){}
        public void onActivityResumed(Activity a){}
        public void onActivityPaused(Activity a){}
        public void onActivityStopped(Activity a){}
        public void onActivitySaveInstanceState(Activity a,Bundle b){}
        public void onActivityDestroyed(Activity a){}
    };
    @Before public void setup(){
        application=(Application)instrumentation.getTargetContext().getApplicationContext();
        application.registerActivityLifecycleCallbacks(callbacks);
        // Observe the destination without loading the live website into fixture state.
        web=instrumentation.addMonitor(WebActivity.class.getName(),new Instrumentation.ActivityResult(Activity.RESULT_CANCELED,null),true);
    }
    @After public void cleanup(){
        client.ready.countDown();
        instrumentation.runOnMainSync(()->{if(launcher.get()!=null)launcher.get().finish();if(web.getLastActivity()!=null)web.getLastActivity().finish();});
        application.unregisterActivityLifecycleCallbacks(callbacks);
        instrumentation.removeMonitor(web);
    }
    private void start() throws Exception {
        instrumentation.startActivitySync(new Intent(instrumentation.getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        assertTrue("The startup check must begin",client.started.await(5,TimeUnit.SECONDS));
    }
    private void assertWebsiteRequested() {
        long deadline=SystemClock.uptimeMillis()+7000;
        while(web.getHits()==0 && SystemClock.uptimeMillis()<deadline)SystemClock.sleep(50);
        assertEquals("The launcher should request its in-app website",1,web.getHits());
    }
    private String status(){
        AtomicReference<String> value=new AtomicReference<>();
        instrumentation.runOnMainSync(()->value.set(((TextView)launcher.get().findViewById(R.id.status)).getText().toString()));
        return value.get();
    }
    @Test public void slowStartupStillShowsTheAvailableUpdate() throws Exception {
        start();
        SystemClock.sleep(3200);
        assertFalse("Startup must not cancel an unfinished check after 2.5 seconds",client.cancelled);
        assertEquals(0,web.getHits());
        assertEquals(launcher.get().getString(R.string.checking),status());
        client.ready.countDown();
        String expected=launcher.get().getString(R.string.update_available,"99.0.0");
        long deadline=SystemClock.uptimeMillis()+5000;
        while(!status().equals(expected)&&SystemClock.uptimeMillis()<deadline)SystemClock.sleep(50);
        assertEquals(expected,status());
        assertEquals(0,web.getHits());
    }
    @Test public void noUpdateOpensTheWebsiteAfterTheCheck() throws Exception {
        client.newer=false;start();client.ready.countDown();
        assertWebsiteRequested();
    }
    @Test public void failedCheckStillOpensTheWebsite() throws Exception {
        client.fail=true;start();client.ready.countDown();
        assertWebsiteRequested();
    }
    @Test public void userCanSkipAnUnfinishedCheck() throws Exception {
        start();
        instrumentation.runOnMainSync(()->launcher.get().findViewById(R.id.open_site).performClick());
        assertWebsiteRequested();
        assertTrue("Explicitly opening the website cancels the pending check",client.cancelled);
    }
    private static final class DelayedClient extends UpdateClient {
        final CountDownLatch started=new CountDownLatch(1),ready=new CountDownLatch(1);
        volatile boolean cancelled,fail,newer=true;
        @Override UpdateManifest check() throws IOException {
            started.countDown();
            try {if(!ready.await(15,TimeUnit.SECONDS))throw new IOException("Fixture timed out");}
            catch(InterruptedException e){Thread.currentThread().interrupt();throw new IOException("Cancelled fixture",e);}
            if(fail)throw new IOException("Controlled connection failure");
            return UpdateManifest.parse("{\"schemaVersion\":1,\"channel\":\"stable\",\"packageId\":\"club.hearthroom.app\",\"versionCode\":"+(newer?2000000000:1)+",\"versionName\":\"99.0.0\",\"downloadUrl\":\"https://downloads.hearthroom.club/latest.apk\",\"sha256\":\""+"0".repeat(64)+"\",\"size\":1,\"releaseNotes\":{\"en\":\"Fixture update\"}}");
        }
        @Override void cancel(){cancelled=true;super.cancel();}
    }
}

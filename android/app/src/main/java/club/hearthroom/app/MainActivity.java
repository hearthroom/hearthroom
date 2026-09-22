package club.hearthroom.app;

import android.app.AlertDialog;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.View;
import android.widget.*;
import androidx.core.content.FileProvider;
import com.google.androidbrowserhelper.trusted.LauncherActivity;
import com.google.androidbrowserhelper.trusted.TwaLauncher;
import java.io.File;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Native update UI is isolated from the website; no JS bridge or provider credentials. */
public final class MainActivity extends LauncherActivity {
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private final Handler main=new Handler(Looper.getMainLooper());
    private UpdateClient client=new UpdateClient();
    private UpdateManifest release;
    private TextView status, notes;
    private Button action;
    private ProgressBar progress;
    private boolean launched, waitingPermission, downloading, manual;
    private File apk;
    @Override protected boolean shouldLaunchImmediately(){return false;}
    @Override protected void onNewIntent(Intent intent){
        super.onNewIntent(intent);
        if("hearthroom".equals(intent.getScheme())&&intent.getData()!=null&&"webview".equals(intent.getData().getHost())){
            setIntent(intent);openSite();
        }
    }
    @Override protected Uri getLaunchingUrl(){
        return Uri.parse(WebPolicy.launchUrl(getIntent().getDataString()));
    }
    @Override protected TwaLauncher.FallbackStrategy getFallbackStrategy(){
        return (context,builder,provider,completed)->{
            context.startActivity(new Intent(context,WebActivity.class).setData(getLaunchingUrl()));
            completed.run();
        };
    }
    @Override protected void onCreate(Bundle state){
        super.onCreate(state);if(isFinishing())return;
        manual="hearthroom".equals(getIntent().getScheme())&&"updates".equals(getIntent().getData().getHost());
        setContentView(R.layout.updater);
        View root=findViewById(R.id.update_root);
        root.setOnApplyWindowInsetsListener((v,insets)->{v.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());return insets;});
        status=findViewById(R.id.status);notes=findViewById(R.id.notes);action=findViewById(R.id.action);progress=findViewById(R.id.progress);
        ((TextView)findViewById(R.id.version)).setText(getString(R.string.installed_version,BuildConfig.VERSION_NAME));
        findViewById(R.id.open_site).setOnClickListener(v->openSite());
        apk=new File(getCacheDir(),"updates/update.apk");
        if(state!=null&&state.containsKey("release")){
            try{release=UpdateManifest.parse(state.getString("release"));showRelease();waitingPermission=state.getBoolean("permission");return;}catch(Exception ignored){}
        }
        check();
        // Wait for the bounded network check; only the user may skip an unfinished check.
    }
    private boolean active(){return !isFinishing()&&!isDestroyed()&&!launched;}
    private void check(){
        status.setText(R.string.checking);action.setVisibility(View.GONE);notes.setText("");
        worker.execute(()->{
            try{UpdateManifest update=client.check();main.post(()->{if(!active())return;if(update.isNewerThan(BuildConfig.VERSION_CODE)){release=update;showRelease();}else if(manual){status.setText(R.string.up_to_date);action.setVisibility(View.VISIBLE);action.setText(R.string.check_again);action.setOnClickListener(v->check());}else openSite();});}
            catch(Exception e){main.post(()->{if(!active())return;if(manual)showError();else openSite();});}
        });
    }
    private void showRelease(){
        status.setText(getString(R.string.update_available,release.versionName));
        notes.setText(release.notes(getResources().getConfiguration().getLocales().get(0).toLanguageTag()));
        action.setVisibility(View.VISIBLE);action.setEnabled(true);action.setText(R.string.download_update);action.setOnClickListener(v->download());
        progress.setVisibility(View.GONE);
    }
    private void download(){
        if(downloading)return;downloading=true;
        action.setEnabled(false);status.setText(R.string.downloading);progress.setVisibility(View.VISIBLE);progress.setProgress(0);
        UpdateManifest expected=release;
        worker.execute(()->{
            try{
                File file=client.download(expected,new File(getCacheDir(),"updates"),percent->main.post(()->{if(active())progress.setProgress(percent);}));
                ApkVerifier.verify(this,file,expected);
                main.post(()->{downloading=false;if(!active())return;progress.setVisibility(View.GONE);action.setEnabled(true);action.setText(R.string.install_update);status.setText(R.string.ready_to_install);action.setOnClickListener(v->install());install();});
            }catch(UpdateClient.Changed changed){main.post(()->{downloading=false;if(active()){release=changed.manifest;showRelease();status.setText(R.string.release_changed);}});}
            catch(Exception e){main.post(()->{downloading=false;if(active())showError();});}
        });
    }
    private void install(){
        if(!getPackageManager().canRequestPackageInstalls()){
            new AlertDialog.Builder(this).setTitle(R.string.allow_install_title).setMessage(R.string.allow_install_body)
                .setPositiveButton(R.string.open_settings,(d,w)->{waitingPermission=true;startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:"+getPackageName())));})
                .setNegativeButton(R.string.not_now,(d,w)->{}).show();return;
        }
        action.setEnabled(false);
        worker.execute(()->{
            try{ApkVerifier.verify(this,apk,release);main.post(()->{
                if(!active())return;action.setEnabled(true);
                try{Uri uri=FileProvider.getUriForFile(this,getPackageName()+".files",apk);
                    Intent intent=new Intent(Intent.ACTION_VIEW).setDataAndType(uri,"application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    startActivity(intent);status.setText(R.string.finish_install);
                }catch(Exception e){showError();}
            });}catch(Exception e){apk.delete();main.post(()->{if(active())showError();});}
        });
    }
    @Override protected void onResume(){super.onResume();if(waitingPermission){waitingPermission=false;if(getPackageManager().canRequestPackageInstalls())install();}}
    @Override protected void onSaveInstanceState(Bundle out){super.onSaveInstanceState(out);if(release!=null)out.putString("release",release.json);out.putBoolean("permission",waitingPermission);}
    private void showError(){status.setText(R.string.update_failed);progress.setVisibility(View.GONE);action.setEnabled(true);action.setVisibility(View.VISIBLE);action.setText(R.string.retry);action.setOnClickListener(v->{if(release==null)check();else download();});}
    private void openSite(){
        if(!active())return;launched=true;client.cancel();worker.shutdownNow();
        if("hearthroom".equals(getIntent().getScheme())&&"webview".equals(getIntent().getData().getHost())){
            startActivity(new Intent(this,WebActivity.class).setData(getLaunchingUrl()));finish();
        }else launchTwa();
    }
    @Override protected void onDestroy(){client.cancel();worker.shutdownNow();main.removeCallbacksAndMessages(null);super.onDestroy();}
}

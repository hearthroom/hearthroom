package club.hearthroom.app;

import android.app.AlertDialog;
import android.content.Intent;
import android.net.ConnectivityManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.view.View;
import android.widget.*;
import androidx.core.content.FileProvider;
import androidx.core.splashscreen.SplashScreen;
import com.google.androidbrowserhelper.trusted.LauncherActivity;
import com.google.androidbrowserhelper.trusted.TwaLauncher;
import java.io.File;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Picks a reachable official route and opens it. Nothing waits for the update check: it runs in the
 * background and a release it finds is offered at the next launch. Native screens are isolated from
 * the website; no JS bridge or provider credentials.
 */
public final class MainActivity extends LauncherActivity {
    static final int ROUTES=7;
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private final ExecutorService probes=Executors.newFixedThreadPool(Routes.HOSTS.size());
    private final Handler main=new Handler(Looper.getMainLooper());
    private UpdateClient client;
    private RouteProbe probe=new RouteProbe();
    private RouteStore store;
    private RoutePlanner planner;
    private UpdateManifest release, known;
    private View waiting, update;
    private TextView waitingStatus, status, notes;
    private Button action, changeRoute;
    private ProgressBar progress;
    private boolean launched, waitingPermission, downloading, manual, inWebView, splash=true;
    private String link, launchUrl, routesReason;
    private long started;
    private int attempt;
    private File apk;
    @Override protected boolean shouldLaunchImmediately(){return false;}
    @Override protected Uri getLaunchingUrl(){return Uri.parse(launchUrl!=null?launchUrl:WebPolicy.HOME);}
    @Override protected TwaLauncher.FallbackStrategy getFallbackStrategy(){
        return (context,builder,provider,completed)->{
            context.startActivity(new Intent(context,WebActivity.class).setData(getLaunchingUrl()));
            completed.run();
        };
    }
    @Override protected void onCreate(Bundle state){
        SplashScreen.installSplashScreen(this).setKeepOnScreenCondition(()->splash);
        super.onCreate(state);if(isFinishing())return;
        store=new RouteStore(this);
        client=client!=null?client:new UpdateClient(Routes.downloadHosts(store.current()));
        setContentView(R.layout.launch);
        Ui.insets(findViewById(R.id.launch_root));
        waiting=findViewById(R.id.waiting);update=findViewById(R.id.update);Ui.column(waiting,update);
        waitingStatus=findViewById(R.id.waiting_status);changeRoute=findViewById(R.id.change_route);
        status=findViewById(R.id.status);notes=findViewById(R.id.notes);action=findViewById(R.id.action);progress=findViewById(R.id.progress);
        changeRoute.setOnClickListener(v->openRoutes(null));
        findViewById(R.id.open_site).setOnClickListener(v->later());
        apk=new File(getCacheDir(),"updates/update.apk");
        // Only a release found by an earlier launch is offered; this launch's check is for next time.
        known=store.knownRelease();
        Background.refresh(this,false);
        if(state!=null&&state.containsKey("release")){
            try{release=UpdateManifest.parse(state.getString("release"));launchUrl=state.getString("launch");showRelease();waitingPermission=state.getBoolean("permission");return;}catch(Exception ignored){}
        }
        route(getIntent());
    }
    @Override protected void onNewIntent(Intent intent){
        super.onNewIntent(intent);
        // A warm start from a shortcut or link: begin again from that intent.
        if(launched||planner!=null||manual){finish();startActivity(new Intent(intent).setClass(this,MainActivity.class));}
    }
    private void route(Intent intent){
        Uri data=intent.getData();
        String host="hearthroom".equals(intent.getScheme())&&data!=null?data.getHost():null;
        inWebView="webview".equals(host);
        if("updates".equals(host)){manual=true;splash=false;showUpdatePanel();check();}
        else if("routes".equals(host)){splash=false;openRoutes(RoutesActivity.FROM_SHORTCUT);}
        else{link=WebPolicy.routeOf(intent.getDataString())!=null?intent.getDataString():null;startLaunch();}
    }
    private boolean active(){return !isFinishing()&&!isDestroyed()&&!launched;}

    // Route selection (S1, S5).
    private void startLaunch(){
        if(!online()){openRoutes(RoutesActivity.OFFLINE);return;}
        String target=link!=null?WebPolicy.routeOf(link):store.current();
        planner=new RoutePlanner(store.routes().enabled(),target,store.fixed());
        started=SystemClock.uptimeMillis();int run=++attempt;
        for(String host:store.routes().enabled())probes.execute(()->{
            long ms=probe.probe(host);
            main.post(()->{if(run!=attempt||!active())return;planner.result(host,ms>=0,SystemClock.uptimeMillis()-started);tick(run);});
        });
        main.postDelayed(()->tick(run),RoutePlanner.SHOW_WAITING);
        main.postDelayed(()->tick(run),RoutePlanner.SLOW);
        main.postDelayed(()->tick(run),RoutePlanner.PROBE_TIMEOUT);
    }
    private void tick(int run){
        if(run!=attempt||!active()||planner==null)return;
        long now=SystemClock.uptimeMillis()-started;
        RoutePlanner.Decision d=planner.decide(now);
        if(d.kind==RoutePlanner.Kind.WAIT){if(now>=RoutePlanner.SHOW_WAITING)showWaiting(now>=RoutePlanner.SLOW?R.string.launch_slow:R.string.launch_connecting,now>=RoutePlanner.SLOW);return;}
        attempt++;
        if(d.kind==RoutePlanner.Kind.OPEN&&d.switched){
            // Switching changes which sign-in the player sees, so it is said before opening, never silently.
            String name=Ui.routeName(this,d.host);
            waitingStatus.setText(store.visited(d.host)?getString(R.string.launch_switched,name):getString(R.string.launch_switched_sign_in,name));
            showWaiting(0,true);
            int run2=attempt;main.postDelayed(()->{if(run2==attempt&&active())proceed(d.host,true);},RoutePlanner.SWITCH_NOTICE);
        }else if(d.kind==RoutePlanner.Kind.OPEN)proceed(d.host,false);
        else openRoutes(d.kind==RoutePlanner.Kind.CHOOSE?RoutesActivity.FIXED_UNAVAILABLE:RoutesActivity.UNREACHABLE);
    }
    private void showWaiting(int text,boolean offerRoutes){
        splash=false;
        if(text!=0)waitingStatus.setText(text);
        Ui.fadeIn(waiting,200);
        if(offerRoutes)changeRoute.setVisibility(View.VISIBLE);
    }
    private boolean online(){
        ConnectivityManager c=getSystemService(ConnectivityManager.class);
        return c==null||c.getActiveNetwork()!=null;
    }
    private void openRoutes(String reason){
        attempt++;routesReason=reason;splash=false;
        startActivityForResult(new Intent(this,RoutesActivity.class).putExtra(RoutesActivity.REASON,reason),ROUTES);
    }
    @Override protected void onActivityResult(int request,int result,Intent data){
        super.onActivityResult(request,result,data);
        if(request!=ROUTES)return;
        if(result==RESULT_OK&&data!=null&&Routes.isRoute(data.getStringExtra(RoutesActivity.HOST)))proceed(data.getStringExtra(RoutesActivity.HOST),false);
        else if(result==RoutesActivity.RESULT_UPDATES){manual=true;showUpdatePanel();check();}
        else if(routesReason==null&&!manual)startLaunch(); // Back from "change route" on S1: keep connecting.
        else finish();
    }
    /** The route is settled: offer a release found earlier, then open the site there. */
    private void proceed(String host,boolean automatic){
        if(!active())return;
        if(link!=null&&host.equals(WebPolicy.routeOf(link)))store.visit(host); // A link opens its own domain without changing the player's route.
        else if(!manual)store.opened(host,automatic);
        launchUrl=link!=null?WebPolicy.onRoute(link,host):"https://"+host+"/";
        if(!manual&&known!=null&&UpdatePolicy.prompt(known.versionCode,BuildConfig.VERSION_CODE,store.deferred(),store.deferredAt(),System.currentTimeMillis())){
            release=known;showUpdatePanel();showRelease();return;
        }
        openSite();
    }

    // Updates (S4).
    private void showUpdatePanel(){splash=false;waiting.setVisibility(View.GONE);update.setVisibility(View.VISIBLE);}
    private void later(){
        if(release!=null&&!manual)store.defer(release.versionCode,System.currentTimeMillis());
        if(launchUrl!=null)openSite();
        else{manual=false;release=null;update.setVisibility(View.GONE);client.cancel();startLaunch();}
    }
    private void check(){
        status.setText(R.string.checking);action.setVisibility(View.GONE);notes.setText("");
        worker.execute(()->{
            try{UpdateManifest found=client.check();store.saveRelease(found.json);main.post(()->{if(!active())return;if(found.isNewerThan(BuildConfig.VERSION_CODE)){release=found;showRelease();}else{status.setText(R.string.up_to_date);action.setVisibility(View.VISIBLE);action.setText(R.string.open_site);action.setOnClickListener(v->later());}});}
            catch(Exception e){main.post(()->{if(active())showError();});}
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
        action.setVisibility(View.INVISIBLE);status.setText(R.string.downloading);progress.setVisibility(View.VISIBLE);progress.setProgress(0);
        UpdateManifest expected=release;
        worker.execute(()->{
            try{
                File file=client.download(expected,new File(getCacheDir(),"updates"),percent->main.post(()->{if(active())progress.setProgress(percent);}));
                ApkVerifier.verify(this,file,expected);
                main.post(()->{downloading=false;if(!active())return;progress.setVisibility(View.GONE);action.setVisibility(View.VISIBLE);action.setEnabled(true);action.setText(R.string.install_update);status.setText(R.string.ready_to_install);action.setOnClickListener(v->install());install();});
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
    @Override protected void onSaveInstanceState(Bundle out){super.onSaveInstanceState(out);if(release!=null){out.putString("release",release.json);out.putString("launch",launchUrl);}out.putBoolean("permission",waitingPermission);}
    private void showError(){status.setText(R.string.update_failed);progress.setVisibility(View.GONE);action.setEnabled(true);action.setVisibility(View.VISIBLE);action.setText(R.string.retry);action.setOnClickListener(v->{if(release==null)check();else download();});}
    private void openSite(){
        if(!active())return;launched=true;splash=false;client.cancel();worker.shutdownNow();probes.shutdownNow();
        if(inWebView){startActivity(new Intent(this,WebActivity.class).setData(getLaunchingUrl()));finish();}
        else launchTwa();
    }
    @Override protected void onDestroy(){client.cancel();worker.shutdownNow();probes.shutdownNow();main.removeCallbacksAndMessages(null);super.onDestroy();}
}

package club.hearthroom.app;

import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/** Reads the release and route list from the first download host that answers; all hosts serve one bucket. */
class UpdateClient {
    private final List<String> hosts;
    private volatile boolean cancelled;
    private volatile HttpURLConnection connection;
    private volatile String source;
    UpdateClient(List<String> hosts) { this.hosts=List.copyOf(hosts); }
    void cancel() { cancelled=true; HttpURLConnection c=connection; if(c!=null)c.disconnect(); }
    /** Opens one HTTPS resource; overridden by tests to stand in for blocked or answering hosts. */
    InputStream open(String address) throws IOException {
        if(cancelled)throw new IOException("Cancelled");
        HttpURLConnection c=(HttpURLConnection)new URL(address).openConnection(); connection=c;
        c.setConnectTimeout(4000);c.setReadTimeout(15000);c.setInstanceFollowRedirects(false);c.setUseCaches(false);
        c.setRequestProperty("Cache-Control","no-cache, no-store");
        c.setRequestProperty("User-Agent","Hearthroom-Android/"+BuildConfig.VERSION_NAME);
        if(c.getResponseCode()!=200){c.disconnect();throw new IOException("Download unavailable");}
        return c.getInputStream();
    }
    /** Hosts in order, starting with the one that last answered. */
    private List<String> order() {
        List<String> out=new ArrayList<>(); String s=source;
        if(s!=null)out.add(s);
        for(String h:hosts)if(!h.equals(s))out.add(h);
        return out;
    }
    private String read(String file,int limit) throws IOException {
        IOException last=new IOException("No download host");
        for(String host:order()) {
            if(cancelled)throw new IOException("Cancelled");
            try(InputStream in=open("https://"+host+"/"+file);ByteArrayOutputStream out=new ByteArrayOutputStream()) {
                byte[] buffer=new byte[4096];int n;
                while((n=in.read(buffer))!=-1){if(cancelled||out.size()+n>limit)throw new IOException("Invalid response");out.write(buffer,0,n);}
                source=host;
                return out.toString(StandardCharsets.UTF_8.name());
            } catch(IOException e){last=e;}
        }
        throw last;
    }
    UpdateManifest check() throws IOException {
        try{return UpdateManifest.parse(read("latest.json",65536));}catch(IllegalArgumentException e){throw new IOException("Invalid response",e);}
    }
    Routes routes() throws IOException {
        try{return Routes.parse(read("routes.json",Routes.MAX_BYTES));}catch(IllegalArgumentException e){throw new IOException("Invalid response",e);}
    }
    File download(UpdateManifest manifest,File directory,Progress progress) throws Exception {
        if(!directory.exists()&&!directory.mkdirs())throw new IOException("Storage unavailable");
        File target=new File(directory,"update.apk");
        for(int attempt=0;attempt<2;attempt++) {
            if(fetch(manifest,target,progress))return target;
            UpdateManifest current=check();
            if(current.versionCode!=manifest.versionCode||!current.sha256.equals(manifest.sha256))throw new Changed(current);
        }
        throw new IOException("Download verification failed");
    }
    /** True when a host delivered the exact APK; a host that fails or serves other bytes yields to the next. */
    private boolean fetch(UpdateManifest manifest,File target,Progress progress) throws Exception {
        Exception last=null;
        for(String host:order()) {
            long bytes=0;long deadline=System.nanoTime()+120_000_000_000L;
            try(InputStream in=open("https://"+host+"/latest.apk");OutputStream out=new FileOutputStream(target)) {
                byte[] buffer=new byte[32768];int n;
                while((n=in.read(buffer))!=-1) {
                    bytes+=n;if(cancelled||bytes>manifest.size||System.nanoTime()>deadline)throw new IOException("Download interrupted");
                    out.write(buffer,0,n);progress.update((int)(bytes*100/manifest.size));
                }
            } catch(Exception e){target.delete();if(cancelled)throw e;last=e;continue;}
            if(manifest.matches(target)){source=host;return true;}
            target.delete();
            return false;
        }
        throw last==null?new IOException("No download host"):last;
    }
    interface Progress {void update(int percent);}
    static final class Changed extends IOException {final UpdateManifest manifest;Changed(UpdateManifest m){super("Release changed");manifest=m;}}
}

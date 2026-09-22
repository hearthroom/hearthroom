package club.hearthroom.app;

import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;

final class UpdateClient {
    private volatile boolean cancelled;
    private volatile HttpURLConnection connection;
    void cancel() { cancelled=true; HttpURLConnection c=connection; if(c!=null)c.disconnect(); }
    private HttpURLConnection connect(String address) throws IOException {
        if(cancelled)throw new IOException("Cancelled");
        HttpURLConnection c=(HttpURLConnection)new URL(address).openConnection(); connection=c;
        c.setConnectTimeout(4000);c.setReadTimeout(15000);c.setInstanceFollowRedirects(false);c.setUseCaches(false);
        c.setRequestProperty("Cache-Control","no-cache, no-store");
        c.setRequestProperty("User-Agent","Hearthroom-Android/"+BuildConfig.VERSION_NAME);
        if(c.getResponseCode()!=200){c.disconnect();throw new IOException("Download unavailable");}
        return c;
    }
    UpdateManifest check() throws IOException {
        HttpURLConnection c=connect(BuildConfig.UPDATE_URL);
        try(InputStream in=c.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()) {
            byte[] buffer=new byte[4096];int n;
            while((n=in.read(buffer))!=-1){if(cancelled||out.size()+n>65536)throw new IOException("Invalid response");out.write(buffer,0,n);}
            try{return UpdateManifest.parse(out.toString(StandardCharsets.UTF_8.name()));}catch(IllegalArgumentException e){throw new IOException("Invalid response",e);}
        } finally {c.disconnect();}
    }
    File download(UpdateManifest manifest,File directory,Progress progress) throws Exception {
        if(!directory.exists()&&!directory.mkdirs())throw new IOException("Storage unavailable");
        File target=new File(directory,"update.apk");
        for(int attempt=0;attempt<2;attempt++) {
            HttpURLConnection c=connect(manifest.downloadUrl);long bytes=0;long deadline=System.nanoTime()+120_000_000_000L;
            try(InputStream in=c.getInputStream();OutputStream out=new FileOutputStream(target)) {
                byte[] buffer=new byte[32768];int n;
                while((n=in.read(buffer))!=-1) {
                    bytes+=n;if(cancelled||bytes>manifest.size||System.nanoTime()>deadline)throw new IOException("Download interrupted");
                    out.write(buffer,0,n);progress.update((int)(bytes*100/manifest.size));
                }
            } catch(Exception e){target.delete();throw e;}finally{c.disconnect();}
            if(manifest.matches(target))return target;
            target.delete();
            UpdateManifest current=check();
            if(current.versionCode!=manifest.versionCode||!current.sha256.equals(manifest.sha256))throw new Changed(current);
        }
        throw new IOException("Download verification failed");
    }
    interface Progress {void update(int percent);}
    static final class Changed extends IOException {final UpdateManifest manifest;Changed(UpdateManifest m){super("Release changed");manifest=m;}}
}

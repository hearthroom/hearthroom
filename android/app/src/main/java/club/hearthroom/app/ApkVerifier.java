package club.hearthroom.app;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.os.Build;
import java.io.File;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

final class ApkVerifier {
    @SuppressWarnings("deprecation")
    static void verify(Context context,File file,UpdateManifest manifest) throws Exception {
        if(!manifest.matches(file))throw new SecurityException("APK integrity mismatch");
        PackageManager pm=context.getPackageManager();
        int flags=Build.VERSION.SDK_INT>=28?PackageManager.GET_SIGNING_CERTIFICATES:PackageManager.GET_SIGNATURES;
        PackageInfo archive=pm.getPackageArchiveInfo(file.getAbsolutePath(),flags);
        PackageInfo installed=pm.getPackageInfo(context.getPackageName(),flags);
        if(archive==null||!context.getPackageName().equals(archive.packageName))throw new SecurityException("Wrong APK package");
        long code=Build.VERSION.SDK_INT>=28?archive.getLongVersionCode():archive.versionCode;
        long current=Build.VERSION.SDK_INT>=28?installed.getLongVersionCode():installed.versionCode;
        if(code!=manifest.versionCode||code<=current)throw new SecurityException("Wrong APK version");
        Signature[] theirs=Build.VERSION.SDK_INT>=28?(archive.signingInfo==null?null:archive.signingInfo.getApkContentsSigners()):archive.signatures;
        Signature[] ours=Build.VERSION.SDK_INT>=28?installed.signingInfo.getApkContentsSigners():installed.signatures;
        if(theirs==null||theirs.length==0||!new HashSet<>(Arrays.asList(ours)).equals(new HashSet<>(Arrays.asList(theirs))))throw new SecurityException("Wrong APK signer");
    }
}

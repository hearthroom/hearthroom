import { afterEach, expect, it, vi } from 'vitest';
import { createMaintenanceMonitor, formatMaintenanceTime, maintenanceLocale } from '../src/lib/maintenance';
afterEach(()=>vi.useRealTimers());
it('polls on/off and keeps an active notice after failed checks; never replays an action',async()=>{
 vi.useFakeTimers();
 const states:unknown[]=[{enabled:true,endsAt:123,messages:{}},new Error('offline'),{enabled:false,endsAt:null,messages:{}}];
 const fetcher=vi.fn(async()=>{const value=states.shift();if(value instanceof Error)throw value;return Response.json(value);});
 const monitor=createMaintenanceMonitor(fetcher);await monitor.check();expect(monitor.state.value.enabled).toBe(true);
 monitor.start();await vi.advanceTimersByTimeAsync(15000);expect(monitor.state.value.enabled).toBe(true);expect(monitor.failed.value).toBe(true);
 await vi.advanceTimersByTimeAsync(15000);expect(monitor.state.value.enabled).toBe(false);expect(fetcher).toHaveBeenCalledTimes(3);
 expect(fetcher.mock.calls.every(call=>call[0]==='/v1/maintenance')).toBe(true);monitor.stop();
});
it('rejects malformed/HTTP error status without treating it as recovered',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(Response.json({enabled:true,endsAt:null,messages:{}})).mockResolvedValueOnce(Response.json({enabled:false},{status:503})).mockResolvedValueOnce(Response.json({}));
 const monitor=createMaintenanceMonitor(fetcher);await monitor.check();await monitor.check();expect(monitor.state.value.enabled).toBe(true);await monitor.check();expect(monitor.state.value.enabled).toBe(true);
});
it('formats a future ETA in the viewer timezone and omits expired estimates',()=>{
 expect(formatMaintenanceTime(1,'en',2)).toBe(null);
 const eta=Date.UTC(2030,0,1);expect(formatMaintenanceTime(eta,'en',0,'Asia/Taipei')).toContain('8:00');
 expect(formatMaintenanceTime(eta,'en',0,'America/New_York')).toContain('7:00');
});

it('uses the same explicit and browser locale decisions before the router starts',()=>{
 expect(maintenanceLocale('/','',false,'en')).toBe('en');
 expect(maintenanceLocale('/ja/play/123','',false,'en')).toBe('ja');
 expect(maintenanceLocale('/123/','?lang=ko',true,'en')).toBe('ko');
 expect(maintenanceLocale('/123/','',true,'ja')).toBe('ja');
 expect(maintenanceLocale('/123/','?lang=unknown',true,'ko')).toBe('ko');
});
it('keeps a server-confirmed maintenance shell blocked when its first poll fails',async()=>{
 const monitor=createMaintenanceMonitor(vi.fn().mockRejectedValue(Error('offline')),true);
 await monitor.check();expect(monitor.state.value.enabled).toBe(true);expect(monitor.failed.value).toBe(true);
});

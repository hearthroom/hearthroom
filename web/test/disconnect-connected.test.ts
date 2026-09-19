import {expect,it} from 'vitest';
import * as connections from '../src/lib/connections';
it('does not expose a self-service disconnect operation',()=>{
 expect('disconnectAccount' in connections).toBe(false);
});

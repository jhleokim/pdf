import {mkdirSync,copyFileSync} from 'node:fs';
mkdirSync(new URL('../.deploy/',import.meta.url),{recursive:true});
copyFileSync(new URL('../index.html',import.meta.url),new URL('../.deploy/index.html',import.meta.url));

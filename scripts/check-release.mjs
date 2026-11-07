import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const root=process.cwd();
const files=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
const findings=[];
const secretPatterns=[/gh[pousr]_[A-Za-z0-9]{30,}/g,/github_pat_[A-Za-z0-9_]{30,}/g,/sk-[A-Za-z0-9]{24,}/g,/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g];
for(const file of files){
 if(/(?:^|\/)(?:node_modules|release)(?:\/|$)/.test(file)||/\.(?:exe|pfx|p12|key)$/i.test(file))findings.push(file+': unexpected publish artifact');
 const data=fs.readFileSync(path.join(root,file));if(data.subarray(0,8192).includes(0))continue;
 if(file==='scripts/check-release.mjs')continue;
 const text=data.toString('utf8');
 for(const re of secretPatterns){re.lastIndex=0;if(re.test(text))findings.push(file+': possible secret (value withheld)');}
}
const required=['LICENSE','THIRD-PARTY-NOTICES.md','CHANGELOG.md','RELEASE-NOTES.md','docs/UPSTREAM.md','docs/USER-GUIDE.zh-CN.md','docs/DEVELOPMENT.zh-CN.md','docs/assets/astro-cn-overview.png','docs/assets/astro-cn-editor.png'];
for(const file of required)if(!files.includes(file))findings.push(file+': not tracked');
const rootPackage=JSON.parse(fs.readFileSync('package.json','utf8'));
const desktop=JSON.parse(fs.readFileSync('apps/desktop/package.json','utf8'));
if(rootPackage.version!==desktop.version)findings.push('release versions differ');
for(const file of ['README.md','README.zh-CN.md','CHANGELOG.md','CONTRIBUTING.md','docs/UPSTREAM.md','docs/USER-GUIDE.zh-CN.md','docs/DEVELOPMENT.zh-CN.md','docs/RELEASE.md']){
 const text=fs.readFileSync(file,'utf8');
 for(const m of text.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)){
  const target=m[1].split('#')[0];if(!target||/^(?:https?:|mailto:)/i.test(target))continue;
  if(!fs.existsSync(path.resolve(path.dirname(file),target)))findings.push(file+': broken relative link '+target);
 }
}
if(!fs.readFileSync('LICENSE','utf8').includes('Copyright (c) 2026 Solen AI'))findings.push('missing original copyright');
if(findings.length){console.error(findings.join('\n'));process.exit(1);}
console.log(JSON.stringify({trackedFiles:files.length,version:rootPackage.version,checks:['tracked file privacy scan','required project documents','relative documentation links','upstream copyright','release version agreement']}));

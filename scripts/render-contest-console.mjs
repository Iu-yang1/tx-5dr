import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
const dir=resolve('contest-console-render');
const markup=readFileSync(resolve(dir,'console-dom.html'),'utf8');
const assets=resolve('packages/web/dist/assets');
const css=readdirSync(assets).filter(n=>n.endsWith('.css')).map(n=>'<link rel="stylesheet" href="'+pathToFileURL(resolve(assets,n)).href+'">').join('');
if(!css)throw new Error('Production CSS missing');
const browser=process.env.CHROME_BIN||'google-chrome';
for(const [width,height] of [[1440,900],[1024,768],[390,844]]){
  const page=resolve(dir,'console-'+width+'.html');
  writeFileSync(page,'<!doctype html><html class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'+css+'<style>html,body{margin:0;min-height:100%;}body{font-family:system-ui}</style></head><body>'+markup+'</body></html>');
  execFileSync(browser,['--headless','--no-sandbox','--disable-gpu','--allow-file-access-from-files','--hide-scrollbars','--window-size='+width+','+height,'--screenshot='+resolve(dir,'console-'+width+'.png'),pathToFileURL(page).href],{stdio:'inherit',timeout:30000});
}

import {defineConfig} from '@playwright/test';
const python=process.env.AUTOG_SOURCE_PYTHON??'../.venv/bin/python';
const quote=(s:string)=>"'"+s.replace(/'/g,"'\\''")+"'";
export default defineConfig({
 testDir:'./tests',workers:1,retries:0,reporter:'list',timeout:20000,
 use:{baseURL:'http://127.0.0.1:18765',browserName:'chromium',channel:'chrome',viewport:{width:1440,height:960}},
 webServer:{command:`${quote(python)} -B ../scripts/ui_test_server.py`,url:'http://127.0.0.1:18765',reuseExistingServer:false,env:{PYTHONDONTWRITEBYTECODE:'1'},timeout:15000}
});

const test=require('node:test')
const assert=require('node:assert/strict')
const {createCommandCenterAuth}=require('./command-center-auth')
test('SSO exchange is authenticated, expires and can only be consumed once',()=>{
 let handler
 const auth=createCommandCenterAuth({app:{post:(path,fn)=>{handler=fn}},secret:'private-test-key',publicUrl:'https://cc.example'})
 const res={statusCode:200,status(n){this.statusCode=n;return this},json(x){this.body=x;return this},setHeader(){},redirect(url){this.url=url;return this},send(){return this}}
 auth.complete(res,{id:'111',state:'bound-state',wheel_token:'private-token'})
 const code=new URL(res.url).searchParams.get('code')
 assert(!res.url.includes('private-token'))
 handler({headers:{},body:{code}},res);assert.equal(res.statusCode,401)
 handler({headers:{'x-lsc-sso-key':'private-test-key'},body:{code}},res);assert.equal(res.body.id,'111')
 handler({headers:{'x-lsc-sso-key':'private-test-key'},body:{code}},res);assert.equal(res.statusCode,401)
})

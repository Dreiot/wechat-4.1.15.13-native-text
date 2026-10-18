"""Synthetic manual imports: never contacts WeChat, DSH or the network."""
import base64,concurrent.futures,hashlib,io,json,pathlib,tempfile,threading,unittest,urllib.request,urllib.error
from types import SimpleNamespace
from unittest.mock import patch
from PIL import Image
from wechat_sticker_collection import StickerCollection
from wechat_sticker_manager import StickerManager,ManagerError

def picture(fmt='GIF',color='red',animated=False):
    image=Image.new('RGB',(24,16),color);out=io.BytesIO()
    image.save(out,format=fmt,save_all=animated,append_images=[Image.new('RGB',(24,16),'blue')] if animated else [],duration=80,loop=0)
    return out.getvalue()

class ManagerTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=pathlib.Path(self.temp.name)
        (self.root/'config').mkdir();self.config={'wechat':{'whitelist':{'private':['789'],'groups':['123','456']},'stickers':{'collectEnabled':False,'shareEnabled':False}}}
        (self.root/'config/wechatagent.json').write_text(json.dumps(self.config),encoding='utf-8')
        self.active=True;self.pool=StickerCollection(self.root,self.root/'account','self',lambda:self.active);self.manager=StickerManager(self.pool)
    def body(self,raw=None,**extra):
        listing=self.manager.listing()
        return {'scope':listing['scope'],'revision':listing['revision'],'name':'开心.gif','description':'开心挥手','tags':['开心','打招呼'],
                'base64':base64.b64encode(raw or picture()).decode(),**extra}
    def assert_code(self,code,callback):
        with self.assertRaises(ManagerError) as caught:callback()
        self.assertEqual(caught.exception.code,code)
    def test_import_keeps_animation_and_shared_access_without_collection_or_share_switch(self):
        raw=picture(animated=True);result=self.manager.import_image(self.body(raw));item=result['items'][0]
        self.assertTrue(item['manual']);self.assertTrue(item['animated']);self.assertEqual(result['count'],1)
        a=self.pool.candidates('wechat:group:123')[0];b=self.pool.candidates('wechat:private:789')[0]
        self.assertNotEqual(a['id'],b['id']);self.assertEqual(self.pool.candidates('wechat:group:999'),[])
        file=pathlib.Path(self.pool.resource(a['id'],'wechat:group:123')['path']);self.assertEqual(file.read_bytes(),raw)
        self.assertEqual(self.manager.image(item['id'],result['scope'],True)['base64'],base64.b64encode(raw).decode())
        preview=self.manager.image(item['id'],result['scope']);self.assertEqual(preview['mime'],'image/png')
        with Image.open(io.BytesIO(base64.b64decode(preview['base64']))) as img:self.assertLessEqual(max(img.size),160)
    def test_static_conversion_dedup_and_edit_are_persistent(self):
        png=picture('PNG');result=self.manager.import_image(self.body(png));digest=result['items'][0]['id']
        self.assertEqual(self.manager.import_image(self.body(png))['count'],1)
        result=self.manager.change(self.body(id=digest,name='赞同',description='表示赞同',tags=['赞同']))
        self.assertEqual(result['items'][0]['description'],'表示赞同')
        restarted=StickerManager(StickerCollection(self.root,self.root/'account','self'))
        self.assertEqual(restarted.listing()['items'][0]['tags'],['赞同'])
        with Image.open(self.pool.folder/(digest+'.gif')) as img:self.assertEqual(img.format,'GIF')
    def test_stale_revision_and_other_account_cannot_mutate_or_preview(self):
        stale=self.body();self.manager.import_image(self.body());before=self.pool.index.read_bytes()
        self.assert_code('STICKER_MANAGER_CHANGED',lambda:self.manager.import_image(stale))
        other=StickerManager(StickerCollection(self.root,self.root/'other','other'))
        self.assertEqual(other.listing()['count'],0)
        self.assert_code('STICKER_MANAGER_ACCOUNT_CHANGED',lambda:other.import_image(self.body()))
        item=self.manager.listing()['items'][0]
        self.assert_code('STICKER_MANAGER_ACCOUNT_CHANGED',lambda:other.image(item['id'],self.pool.account_key))
        self.active=False
        self.assert_code('STICKER_MANAGER_ACCOUNT_CHANGED',lambda:self.manager.change(self.body(id=item['id']),True))
        self.assertEqual(before,self.pool.index.read_bytes())
    def test_full_pool_rejects_new_manual_import_but_accepts_dedup_without_overwrite(self):
        for index in range(50):self.manager.import_image(self.body(picture(color=(index,40,70))))
        before=self.pool.index.read_bytes()
        self.assert_code('STICKER_MANAGER_FULL',lambda:self.manager.import_image(self.body(picture(color='green'))))
        self.assertEqual(self.pool.index.read_bytes(),before)
        self.assertEqual(self.manager.import_image(self.body(picture(color=(0,40,70))))['count'],50)
    def test_delete_cancels_review_aliases_and_auto_recollection_but_manual_reimport_works(self):
        raw=picture();result=self.manager.import_image(self.body(raw));digest=result['items'][0]['id'];candidate=self.pool.candidates('wechat:group:123')[0]
        state=self.pool.read();state['review']={'ticket':'a'*64,'revision':self.pool.revision(state),'startedAt':1,'candidates':[]};self.pool.write(state)
        self.manager.change(self.body(id=digest),True)
        self.assertIsNone(self.pool.read()['review']);self.assertIsNone(self.pool.resource(candidate['id'],'wechat:group:123'))
        self.assertFalse((self.pool.folder/(digest+'.gif')).exists())
        self.config['wechat']['stickers']['collectEnabled']=True
        (self.root/'config/wechatagent.json').write_text(json.dumps(self.config))
        md5=hashlib.md5(raw).hexdigest()
        self.assertFalse(self.pool.store(raw,{'md5':md5},md5,'wechat:group:123',1,'b'*64))
        self.assertEqual(self.manager.import_image(self.body(raw))['count'],1)
        self.assertNotIn(digest,self.pool.read()['removed'])
    def test_invalid_input_and_path_tricks_leave_pool_unchanged(self):
        cases=[self.body(b'<svg>bad</svg>'),self.body(name='../outside.gif'),self.body(tags=['x'*17]),self.body(base64='invalid!')]
        image=Image.new('RGB',(4097,1));out=io.BytesIO();image.save(out,format='PNG');cases.append(self.body(out.getvalue()))
        for body in cases:
            with self.assertRaises(ManagerError):self.manager.import_image(body)
        self.assertEqual(self.manager.listing()['count'],0);self.assertFalse(self.pool.index.exists())
    def test_import_busy_does_not_wait_for_another_image(self):
        self.pool.import_lock.acquire()
        try:self.assert_code('STICKER_MANAGER_BUSY',lambda:self.manager.import_image(self.body()))
        finally:self.pool.import_lock.release()
    def test_parallel_imports_never_exceed_capacity(self):
        for index in range(49):self.manager.import_image(self.body(picture(color=(index,10,20))))
        first=self.body(picture(color='green'));second=self.body(picture(color='blue'))
        def run(body):
            try:self.manager.import_image(body);return 'ok'
            except ManagerError as error:return error.code
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:results=list(executor.map(run,[first,second]))
        self.assertEqual(results.count('ok'),1);self.assertEqual(self.manager.listing()['count'],50)
    def test_metadata_and_native_bound_paths_work_in_reader_candidates(self):
        import importlib.util
        from wechat_sticker_labels import StickerLabels
        spec=importlib.util.spec_from_file_location('managed_reader',pathlib.Path(__file__).with_name('reader-api.py'));api=importlib.util.module_from_spec(spec);spec.loader.exec_module(api)
        self.manager.import_image(self.body());reader=api.Reader.__new__(api.Reader)
        reader.root=self.root;reader.account=self.root/'account';reader.sticker_collection=self.pool;reader.sticker_labels=StickerLabels(self.root/'labels.json')
        reader.image_index={};reader.pump_sticker_collection=lambda:None
        choices=reader.sticker_candidates('wechat:group:123','开心')
        self.assertEqual(choices[0]['tags'],['开心','打招呼'])
        native=reader.resolve_sticker(choices[0]['id'],'wechat:group:123')
        self.assertEqual(pathlib.Path(native['path']).parent,self.root/'state/stickers/outgoing')
    def test_real_reader_http_manager_requires_token_and_checks_account_scope(self):
        import importlib.util
        spec=importlib.util.spec_from_file_location('http_managed_reader',pathlib.Path(__file__).with_name('reader-api.py'));api=importlib.util.module_from_spec(spec);spec.loader.exec_module(api)
        ready=threading.Event();servers=[]
        def factory(port,handler):
            server=api.ThreadingHTTPServer(('127.0.0.1',0),handler);servers.append(server);ready.set();return server
        reader=SimpleNamespace(sticker_collection=self.pool,poll=lambda:None,stop=threading.Event(),sticker_executor=SimpleNamespace(shutdown=lambda **_:None),sticker_review_executor=SimpleNamespace(shutdown=lambda **_:None))
        with patch.object(api,'create_reader_server',factory):
            thread=threading.Thread(target=api.serve,args=(reader,0,'fixture-token'),daemon=True);thread.start();self.assertTrue(ready.wait(5))
            base='http://127.0.0.1:'+str(servers[0].server_port)
            def request(route,body=None,token='fixture-token'):
                req=urllib.request.Request(base+'/api/v1/stickers/manage'+route,data=json.dumps(body).encode() if body is not None else None,headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'})
                try:
                    with urllib.request.urlopen(req,timeout=5) as response:return response.status,json.load(response)
                except urllib.error.HTTPError as error:return error.code,json.load(error)
            try:
                self.assertEqual(request('',token='wrong')[0],401)
                self.assertEqual(request('/import',self.body())[0],200)
                data=request('')[1];item=data['items'][0]
                self.assertEqual(request('/image?id='+item['id']+'&scope='+data['scope'])[1]['mime'],'image/png')
                body=self.body(id=item['id']);body['scope']='wrong'
                self.assertEqual(request('/delete',body)[0],409)
                self.assertEqual(request('/edit',self.body(id=item['id'],name='新名称'))[0],200)
                self.assertEqual(request('/delete',self.body(id=item['id']))[1]['count'],0)
                self.assertEqual(request('/import',{'base64':'broken'})[0],409)
            finally:servers[0].shutdown();thread.join(5)

if __name__=='__main__':unittest.main()

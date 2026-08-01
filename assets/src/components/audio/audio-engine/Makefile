default:
	$(CC) build.c -o build$(EXEEXT)
ifeq ($(OS),Windows_NT)
	build.exe $(ARGS)
else
	./build $(ARGS)
endif
# upload_host:
# 	git fetch origin binaries:binaries
# 	git checkout binaries
# 	cp dist/*.node .
# 	git add *.node
# 	git commit -m "Manually updated host binaries"
# 	git push origin binaries
# 	git checkout master
upload_host:
	extragon upload repo audio-engine/1.0 dist/*.node
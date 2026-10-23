# tools/cikernel.py — print Core Image's built-in kernel sources (CI kernel language) from the dyld shared cache.
# usage: python3 -I tools/cikernel.py _bumpDistortion _twirl ...   (list names: grep -a -o 'kernel vec4 _[A-Za-z0-9_]*' on the cache)
import mmap, sys, re
f = open('/System/Volumes/Preboot/Cryptexes/OS/System/Library/dyld/dyld_shared_cache_arm64e', 'rb')
m = mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ)
for name in sys.argv[1:]:
    for mt in re.finditer(rb'kernel \w+ ' + name.encode() + rb'\s*\(', m):
        i = mt.start(); j = m.find(b'{', i); depth = 0; k = j
        while True:
            c = m[k:k+1]
            if c == b'{': depth += 1
            elif c == b'}':
                depth -= 1
                if depth == 0: break
            k += 1
        print(f'--- {name} @{i:#x}'); print(m[i:k+1].decode('latin-1'))

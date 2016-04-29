js-local-bam
============

Javascript local BAM and BAI index file parsing and processing


Include the following libs:

* https:raw.github.com/vjeux/jDataView/master/src/jdataview.js
* https:raw.github.com/vjeux/jParser/master/src/jparser.js
* inflate.js (fetch and place or fetch remotely)
* pako_deflate.min.js (fetch and place or fetch remotely)
* jsbgzf.js (fetch and place or fetch remotely)
* js-bv-common.js (fetch and place or fetch remotely)
* js-local-bam.js (this file)

May also want bv-local-sampling.js

*Note*: JSLibs contains a snapshot of all the dependencies current to
 this release (see file2.html for example inclusion).


Basic user level API.  There are two 'object' types with
constructors:

---
`readBaiFile` which takes a bam index (bai) filespec and initializes
a bai reader.  Synopsis:


  * `getIndex` - builds the index information
  * `bin2Ranges` - returns the chunk information for a [ref binid]
  * `bin2Beg` - returns first chunk of bin
  * `bin2End` - returns last chunk of bin
  * `getChunks` - returns all chunks for bins covering region in ref

Details below

---
`readBinaryBAM` which takes a bai filespec and a BGZF BAM filespec
initializes a bai reader and builds binary BAM reader. Synopsis:


  * `bamFront` - obtain and return the bam front material:
    - the header
    - the reference list

  * `refName2Index` - takes a string reference name and returns its
    list index

  * `refsWithReads` - returns a vector of all the listed references
    which have actual read data

  * `getAlnUbas` - Obtains unsigned byte arrays (UBAs) for a set of
    alignments associated with a ref and region

  * `getAlns` - obtains alignment information, in either text or
    binary format, for a ref and region.  The binary format is for
    lower level functions constructing new bam file chunks
    (typically from a sampling)

  * `region2BAM` - takes a region map defining a reference and region
    and builds a vector of bgzf blocks covering the alignment data.

  * `regions2BAM` - takes a vector of region maps and for each
    invokes region2BAM, returning the resulting vector of vectors
    of bam chunks

  * `throttledRegions2BAM` - like regsion2BAM, but builds a
    continuation that controls the stepping process and passes it
    to user cbfn for control along with bam data

  * `getChunks` - returns all chunks covered by region

Details below

Examples:

```javascript
With files[0] == bam file
     files[1] == bai file

var bamR = new readBinaryBAM(files[1], files[0]);
bamR.bamFront(function(){}); Get bam front (head and refs)
var withReads = bamR.refsWithReads().map(function(x) {return x[1]});
var alns = []
bamR.getAlns("20", 1000, 10000, function(alnseq){alns = alnseq})
...
Stream sampled regions somewhere
var refsNregions = samplingRegions(withReads, {}).regions;
var bamblks = [bamR.headUba];

stream(bamR.headUba.buffer); // Send header

var regcnt = 0;
var totcnt = bgzfHdr.length + EOFblk.length;

bamR.throttledRegions2BAM(
  refsNregions,
  function(bgzfblks, contfn, regmap){
    // Only send two regions
    if (bamblks && regcnt < 2) {
      bgzfblks.forEach(
        function(bgzfblk){stream.write(bgzfblk.buffer)});
      totcnt = totcnt + bgzfblks.reduce(
        function(S, x){return S+x.length},0);
      regcnt = regcnt + 1;
      contfn.call(this, regmap); // Step next region
    } else {
      stream(EOFblk.buffer);
      console.log("FINISHED, total bytes sent:", totcnt)}})
```


---

####`readBaiFile`, API details:


---
```javascript
function readBaiFile(baiFile)
```
Constructor for bai reader and decoder.  `baifile` is a bai binary
index file.


---
```javascript
readBaiFile.prototype.getIndex = function(cb)
```
Main function for a bai reader.  Obtains and decodes the index
and caches information on it used by other methods.  So, must be
called before others.


---
```javascript
readBaiFile.prototype.bin2Ranges = function(ref, binid)
```
Takes a `ref` and `binid` and builds a return vector mapped from the
chunk sequence of bin, where each element is a two element vector
defining the region of a chunk.  The begin and end of each region
are the base virtual file offsets (the 16 bit right shifted values)
and the offset within the INflated block (the lower 16 bits).
Returns a vector `[[[vfbeg, bobeg], [vfend, boend]], ...]` where

* `vfbeg` is the virtual file offset of beginning bgzf block
* `bobeg` is the offset within the inflated block of that block
* `vfend` is the virtual file offset of ending bgzf block
* `boend` is the offset of last byte in that block


---
```javascript
readBaiFile.prototype.bin2Beg = function(ref, binid)
```
First chunk region of `binid` of `ref`.


---
```javascript
readBaiFile.prototype.bin2End = function(ref, binid)
```
Last chunk region of `binid` of `ref`.


---
```javascript
readBaiFile.prototype.getChunks = function(ref, beg, end)
```
For a reference `ref` region defined by `beg` and `end` return the set of
chunks of all bins involved as a _flat_ vector of two element
vectors, each defining a region of a bin.


---
####`readBinaryBAM`, API details:


---
```javascript
function readBinaryBAM (baiFile, bamFile, cb)
```
Constructor for BGZF BAM reader and decoder.  `baifile` is a bai
binary index file for `bamFile`, a BGZF encoded BAM file.  Inits and
builds index and initializes the BAM reader.


---
```javascript
readBinaryBAM.prototype.bamFront = function(cb)
```
Obtain the front (apriori schema) data section of a BAM from its
reader.  The front section consists of a static fixed size
'header', and the more important variable length sequence of
variable sized references.  Each reference has a name, length
(l_ref:), and implicitly its index location in the reference
sequence.

Parses out the header and references, adds attributes 'head' and
'refs' respectively to the BAM reader for them, and computes a
reference name to reference index map (hash map) and places this on
attribute 'refhash'.  Finally, calls `cb` with the header and refs:
`cb(head, refs)`.


---
```javascript
readBinaryBAM.prototype.refName2Index = function(name)
```
Converts a reference `name` to its bam index.  References in bam
processing always need to be by their index.  Requires that
bamFront has run.


---
```javascript
readBinaryBAM.prototype.refsWithReads = function(cb, runfront)
```
Return the set of references that have reads in this bam. Requires
that bamFront has run or if `runfront` is true, will implicitly run
`bamFront`.  If `runfront` is not true and `bamFront` has not yet run,
calls `cb` with undefined.

Returns a `[[ref-bin-info, ref-name-info]...]`

Where ref-bin-info = {binseq: .., intervseq: ...} is the index file
information for the reference, and ref-bame-info = {name: ...,
l_ref: ...} is the corresponding BAM file reference name info in
the BAM header.


---
```javascript
readBinaryBAM.prototype.getAlnUbas = function(ref, beg, end, cbfn, binary)
```
Obtains the set of raw unsigned byte arrays containing the
alignments of `ref` in the region `[beg, end]`.  `Ref` may be a reference
index or reference name (in which case it is implicitly converted
to its index - see `refName2Index`).  On finish, calls `cb` with the
vector of ubas.  Note `cb` is called with this == the bam reader.

Due to the adhoc structure of aln information, alignment parsing
needs to be split between obtaining (via parse) the raw byte arrays
containing the alignments and the alignments contained in the these
arrays via secondary parse - see getAlns.


---
```javascript
readBinaryBAM.prototype.getAlns = function(ref, beg, end, cbfn, options)
```
Main function for BAM reader.  For a reference `ref` alignment region
defined by `beg` and `end`, obtains the set of bins and chunks covering
the region, inflates the corresponding data blocks, obtains the raw
unsigned byte arrays for each contained alignment, parses each such
array for the detailed alignement information in it, producing a
vector of all alignments for ref in the region.  Calls `cbfn` with
the vector.  Note `cbfn` is called with this == the bam reader.

Makes use of `getAlnUbas` as the intermediary parse for the set of
unsigned byte arrays for the region contained alignments.

`options` is a map of flags:

  `binary`: true/false, if true returns the raw UBArrays (low level usages)
  `exact`:  true/false, if true returns just the aln info exactly > beg <= end
  `full`:   true/false, if true decodes cigar and seq fields as well


---
```javascript
readBinaryBAM.prototype.region2BAM = function(regmap, cbfn)
```
Takes a region map `regmap`, representing a reference and region of
form `{name:, start:, end:}`, where `name` denotes a reference
(typically the name of a reference from the reference index), and
`start` and `end` denote the beginning and end of a region on
reference.

Computes the set of unsigned byte array block chunks covering the
region, ensures ubas are maximal blocks for bgzf deflation (see
coalesce65KBCnks for more information), and bgzf deflates each
block to a corresponding legal bgzf block.

Calls `cbfn` with the resulting vector of bgzf blocks for the region.

Can be used to write custom bam renderers from segments of the
containing bam.  See `regions2BAM` for an example use that works
across a set of ref/region maps as returned by `samplingRegions`.


---
```javascript
readBinaryBAM.prototype.regions2BAM = function(refsNregions, cbfn)
```
Takes a vector `refsNregions` of region maps `[regmap, ...]` and for
each such regmap, calls `readBinaryBAM.region2BAM(regmap,
cbfn)`. Each such call will be synchronized to the required IO
involved and thus calls will be ordered by order of regmaps in
`refsNregions`.  Details of regmap format can be found at `region2BAM`.

Example of use: (`bamR` is assumed to be a `readBinaryBAM` reader)

```javascript
var withReads = bamR.refsWithReads().map(function(x) {return x[1]});
var refsNregions = samplingRegions(withReads, {}).regions;
var totcnt = 0;
var bamblks = [bamR.headUba];

bamR.regions2BAM(
  refsNregions,
  function(bgzfblks){
    if (bgzfblks) {
      console.log(bgzfblks);
      bamblks.push(bgzfblks);
      totcnt = totcnt + bgzfblks.reduce(
        function(S, x){return S+x.length},0)
    } else {
      bamblks.push(EOFblk);
      console.log("FINISHED")}});
```
**NOTE:** in this variant _all_ regmaps in refsNregions are processed.
See throttledRegions2BAM for variant where the user, via cbfn /
continuation, has more control.


---
```javascript
readBinaryBAM.prototype.throttledRegions2BAM = function(refsNregions, cbfn)
```
Similar to regions2BAM but where `cbfn` controls when and how much of
`refsNregions` to step through. `cbfn` must have the following
signature to make this work:
```javascript
function (bgzfBlks, contfn, regmap) {...}
```
The first argument is just as for `cbfn` for `regions2BAM`.  The next
two provide the throttling effect. `contfn` closes over the control
state of the processing (basically the refmaps left) to enable user
determined stepping.  To make the next step through `refsNregions`,
`cbfn` would call the continuation function `contfn` with `regmap` as
its argument:

```javascript
function (bgzfBlks, contfn, regmap){
 ...
 if (continue) {
   ...
   contfn.call(this, regmap); NOTE 'this' here is the binary bam reader
 } else {
   ...
 }
}
```

Example of use: (`bamR` is assumed to be a `readBinaryBAM` reader)

```javascript
var withReads = bamR.refsWithReads().map(function(x) {return x[1]});
var refsNregions = samplingRegions(withReads, {}).regions;
var bamblks = [bamR.headUba];

var bgzfHdr = bgzf(bamR.headUba);
stream([bgzfHdr]); Send header

var regcnt = 0;
var totcnt = bgzfHdr.length + EOFblk.length;

bamR.throttledRegions2BAM(
  refsNregions,
  function(bgzfblks, fn, regmap){
    Only send two regions
    if (bamblks && regcnt < 2) {
      stream(bgzfblks);
      totcnt = totcnt + bgzfblks.reduce(
        function(S, x){return S+x.length},0);
      regcnt = regcnt + 1;
      fn.call(this, regmap);     Step next region
    } else {
      stream(EOFblk);
      console.log("FINISHED, total bytes sent:", totcnt)}})
```

---
```javascript
readBinaryBAM.prototype.getChunks = function(ref, beg, end)
```
Synonym for bai `getChunks`.  Directly callable on a bamReader.

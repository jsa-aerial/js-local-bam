//--------------------------------------------------------------------------//
//                                                                          //
//                              J S B G Z F                                 //
//                                                                          //
//                                                                          //
// Copyright (c) 2014-2014 Trustees of Boston College                       //
//                                                                          //
// Permission is hereby granted, free of charge, to any person obtaining    //
// a copy of this software and associated documentation files (the          //
// "Software"), to deal in the Software without restriction, including      //
// without limitation the rights to use, copy, modify, merge, publish,      //
// distribute, sublicense, and/or sell copies of the Software, and to       //
// permit persons to whom the Software is furnished to do so, subject to    //
// the following conditions:                                                //
//                                                                          //
// The above copyright notice and this permission notice shall be           //
// included in all copies or substantial portions of the Software.          //
//                                                                          //
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,          //
// EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF       //
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND                    //
// NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE   //
// LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION   //
// OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION    //
// WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.          //
//                                                                          //
// Author: Jon Anthony                                                      //
//                                                                          //
//--------------------------------------------------------------------------//
//

// Usage:
//
// Include the following libs:
//
// inflate.js (fetch and place or fetch remotely)
// pako_deflate.min.js (fetch and place or fetch remotely)
// jsbgzf.js (this file)
//
// API consists of top level functions - no constructor needed or
// wanted.
//
// * buffer2String - take a unsigned byte array (UBA) and convert to a
//   string. Only works for iso-latin-1 (or ascii - 8 bit bytes) - no
//   UTF-8 (unicode, ...) here
//
// * getChunk - low level function to obtain a chunk of a file as a UBA
//
// * getBGZFHD - parses and returns as a map bgzf headers (each
//   compressed block has a bgzf header)
//
// * nextBlockOffset - from a provided legal compressed block offset,
//   obtain the offset of the next compressed block
//
// * blockSize - from a provided legal compressed block offset,
//   compute size of contained compressed block
//
// * countBlocks - counts the total number of bgzf (compressed) blocks
//   in file
//
// * inflateBlock - from a provided legal compressed block offset,
//   inflate the blcck to its UBA representation.
//
// * inflateBlock2stg - same as inflateBlock but then use
//   buffer2String to convert inflated block to a string
//
// * inflateRegion - from a provided starting compressed block offset
//   and some ending offset (need not be a block offset), expand all
//   blocks covereed by region to a single UBA
//
// * inflateAllBlocks - inflate all blocks in file to a single UBA.
//   Likely not usable for large files.
//
// * inflateRegion2Stg - same as inflateBlock2stg, but for
//   inflateRegion
//
// * inflateAll2Stg - same as inflateRegioin2Stg, but where region is
//   the entire file
//
// * bgzf - takes a UBA of data and deflates to a bgzf compressed
//   block
//
// Appending buffers - used internally, but are intended for public
// use as well
// * appendBuffer - append two unsigned byte arrays (UBA)
// * appendBuffers - append vector of UBAs




// Take two array buffers BUFFER1 and BUFFER2 and, treating them as
// simple byte arrays, return a new byte array of their catenation.
// If asUint8 (boolean) is true, return the uint8 'view' array
// otherwise return the underlying ArrayBuffer.
function appendBuffer( buff1, buff2, asUint8) {
  var tmp = new Uint8Array( buff1.byteLength + buff2.byteLength );
  var b1 = (buff1 instanceof Uint8Array) ? buff1 : new Uint8Array(buff1);
  var b2 = (buff2 instanceof Uint8Array) ? buff2 : new Uint8Array(buff2);
  tmp.set(b1, 0);
  tmp.set(b2, b1.byteLength);
  return (asUint8) ? tmp : tmp.buffer;
}

// Take a vector of array buffers and treating them as simple byte
// arrays, return a new byte array of their catenation.  If asUint8
// (boolean) is true, return the uint8 'view' array otherwise return
// the underlying ArrayBuffer.
function appendBuffers(bufferVec, asUint8) {
    var totalSize = 0;
    for (var i = 0; i < bufferVec.length; i++) {
        totalSize = totalSize + bufferVec[i].byteLength;
    };

    var tmp;
    if (bufferVec.length == 1) {
        var b = bufferVec[0];
        tmp = (b instanceof Uint8Array) ? b : new Uint8Array(b);
    } else {
        tmp = new Uint8Array(totalSize);
        var offset = 0;
        for (var i = 0; i < bufferVec.length; i++) {
            var b = bufferVec[i];
            var buff = (b instanceof Uint8Array) ? b :new Uint8Array(b);
            tmp.set(buff, offset);
            offset = offset + b.byteLength;
        };
    };
    return (asUint8) ? tmp : tmp.buffer;
}

// Take an array buffer considered as a byte stream, and return the
// string representation of the buffer.  This works only on latin 1
// character encodings (no UTF8).
function buffer2String (resultBuffer) {
    var s = '';
    var resultBB = new Uint8Array(resultBuffer);
    for (var i = 0; i < resultBB.length; ++i) {
        s += String.fromCharCode(resultBB[i]);
    }
    return s;
}




//===========================================================================//

// The BGZF header format for compressed blocks.  These blocks are all
// <= 2^16 (64KB) of uncompressed data.  The main header is the
// standard gzip header information, with the xlen field here set to 6
// (indicating an extra 6 bytes of subheader).  The subheader defines
// the specifics for the BGZ information.  The si* are required gzip
// subheader id information (can be basically anything fitting in two
// bytes, so basically two latin-1 characters), here they are 'BC'
// (code points 66 and 67).  SLEN indicates the size of the subheader
// data (here 2, indicating BSIZE is 2 bytes), and BSIZE is the actual
// 'real' extra data and is an unsigned 16 bit integer indicating the
// total block size - 1.  The actual compressed data follows this
// header and is BSIZE - header size - 8 (where the 8 accounts for 2
// 32 bit integers at the end holding the CRC and uncompressed size).
var bgzf_hd_fmt = {
    header: {
        id1:   'uint8',
        id2:   'uint8',
        cm:    'uint8',
        flg:   'uint8',
        mtime: 'uint32',
        xfl:   'uint8',
        os:    'uint8',
        xlen:  'uint16'
    },

    subheader: {
        si1:   'uint8',
        si2:   'uint8',
        slen:  'uint16',
        bsize: 'uint16'
    },

    bgzfHd: {head: 'header', subhead: 'subheader'}
};


// The size (in bytes) of a bgzf block header.
var hdSize = 18;

// The bgzf EOF marker block
EOFblk = new Uint8Array(
               [0x1f, 0x8b, 0x08, 0x04,
                0x00, 0x00, 0x00, 0x00,
                0x00, 0xff, 0x06, 0x00,
                0x42, 0x43, 0x02, 0x00,
                0x1b, 0x00, 0x03, 0x00,
                0x00, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x00]);



// Low level binary file reader.  Reads bytes from base offset BEG to
// END inclusive as an array of unsigned bytes using a new FileReader
// for each read.  CBFN is the callback to call when read is finished
// and it is passed the FileReader object.
function getChunk (f, beg, end, cbfn) {
    var reader = new FileReader();
    reader.onloadend = function(evt) {
        if (evt.target.readyState == FileReader.DONE) {
            return cbfn.call(this, reader);
        } else {
            return alert('Bad read for ' + f + ' at ' + beg + ', ' + end +
                         'status: ' + evt.target.readyState);
        };
    };
    reader.readAsArrayBuffer(f.slice(beg, end));
}


// Low level function that obtains the BGZF header for the BGZF
// compressed file F at base byte offset OFFSET.  Decodes the header
// and passes the resulting JS object, representing the header
// information with fields as defined by template bgzf_hd_fmt, to
// CBFN.
function getBGZFHD (f, offset, cbfn) {
    var cb = function (r) {
        var a = new Uint8Array(r.result);
        var hdbuf = a.buffer;
        var parser = new jParser(hdbuf, bgzf_hd_fmt);
        var hdobj = parser.parse('bgzfHd');
        return cbfn.call(this, hdobj);
    };
    getChunk(f, offset, offset + hdSize, cb);
}

// Low level function that given BGZF file F, base offset OFFSET,
// obtains the offset of the next block and passes to CBFN
function nextBlockOffset (f, offset, cbfn) {
    var cb = function(hdobj) {
        var bsize = hdobj.subhead.bsize;
        return cbfn.call(this, offset + bsize + 1);
    };
    getBGZFHD(f, offset, cb);
}

// Low level function that given BGZF file F, base offset OFFSET,
// obtains the block size of block at OFFSET and passes to CBFN
function blockSize (f, offset, cbfn) {
    var cb = function(hdobj) {
        var blksize = hdobj.subhead.bsize + 1;
        return cbfn.call(this, blksize);
    };
    getBGZFHD(f, offset, cb);
}

// Low level function that given BGZF file F, obtains the total count
// of _gzip_ blocks in F.  Each of these will correspond to one of
// BGZF's 64KB uncompressed blocks.  NOTE: a chunk or interval may
// contain more than one of these blocks! Passes count to CBFN.
//
// WARNING: for large BGZF files this can take a looonnnggggg time.
function countBlocks (f, cbfn) {
    var blkCnt = 1;
    var cb = function(x) {
        if (x<files[0].size) {
            blkCnt = blkCnt+1;
            nextBlockOffset(f, x, cb);
        } else {
            cbfn.call(this, blkCnt);
        };
    };
    nextBlockOffset(f, 0, cb);
}


// Low level function that given BGZF file F, base off BLOCKOFFSET,
// inflates the single _gzip_ compressed block at that location and
// passes the base array buffer obtained to CBFN.  NOTE: this uses the
// JSZlib library.
function inflateBlock(f, blockOffset, cbfn) {
    var cb2 = function (r) {
        var a = new Uint8Array(r.result);
        var inBuffer = a.buffer;
        var resBuf = jszlib_inflate_buffer(inBuffer, hdSize, a.length - hdSize);
        return cbfn.call(this, resBuf);
    };
    var cb = function (blksize) {
        //console.log(blockOffset, blksize);
        getChunk(f, blockOffset, blockOffset + blksize, cb2);
    };
    blockSize(f, blockOffset, cb);
}

// Low level function that given BGZF file F, base offset BLOCKOFFSET,
// inflates the single _gzip_ compressed block at that location,
// converts the array buffer so obtained to a string (latin-1) and
// passes that to CBFN
function inflateBlock2stg(f, blockOffset, cbfn) {
    var cb = function (resBuf) {
        var res = buffer2String(resBuf);
        return cbfn.call(this, res);
    };
    inflateBlock(f, blockOffset, cb);
}


// Mid level function that given a BGZF file F, a region defined by
// offsets BEGOFFSET and ENDOFFSET, fetches, inflates and appends all
// (_inclusively_) the _gzip_ blocks in the region into a single array
// buffer and passes to CBFN. as its first argument, and passes the
// size (in bytes) of the last inflated block in the region as second
// argument.
function inflateRegion (f, begOffset, endOffset, cbfn) {
    var blockOffset = begOffset;
    var res = [];
    var cb = function (x) {
        res.push(x);
        nextBlockOffset(
            f, blockOffset,
            function(x){
                blockOffset = x;
                if (blockOffset <= endOffset) {
                    return inflateBlock(f, blockOffset, cb);
                } else {
                    var resBuf = appendBuffers(res);
                    return cbfn.call(this, resBuf, res.slice(-1)[0].byteLength);
                };
            });
    };
    inflateBlock(f, blockOffset, cb);
}

// Mid level function that given a BGZF file F, inflates all the
// contained _gzip blocks, appends them all together into a single
// array buffer and passes that to CBFN.  Calling this on any 'large'
// BGZF _data_ file (bai should be fine) will likely blow up with
// memory exceeded.
function inflateAllBlocks(f, cbfn) {
    return inflateRegion(f, 0, f.size-1, cbfn);
}


// Mid level function that given a BGZF file F, a region defined by
// offsets BEGOFFSET and ENDOFFSET, fetches, inflates, appends
// together and converts to a string all the gzip blocks in region.
// Passes the string to CBFN
function inflateRegion2Stg (f, begOffset, endOffset, cbfn) {
    var cb = function (resBuf, ebsz) {
        var res = buffer2String(resBuf);
        return cbfn.call(this, res, ebsz);
    };
    inflateRegion(f, begOffset, endOffset, cb);
}

// Mid level function.  Inflates the entire BGZF file F, converts to a
// total string and passes to CBFN.  Calling this on any 'large' BGZF
// _data_ file will likely blow off with memory exceeded.
function inflateAll2Stg (f, cbfn) {
    var cb = function (resBuf) {
        var res = buffer2String(resBuf);
        return cbfn.call(this, res);
    };
    inflateAllBlocks(f, cb);
}




// ------------------------  Deflation Operations --------------------------//

// BGZF deflation; takes an unsigned byte array UBA, which is taken as
// not yet deflated (though you could try deflating an already
// deflated block, but this will likely lose) and deflate it to a
// legal BGZF formatted compressed uba (including BSIZE payload).
function bgzf (uba) {
    var bgzfUba =
        new pako.gzip(
            uba,
            {header: {os: 255, time: 0,
                      extra: new Uint8Array([66,67,2,0,255,255])}});
    var bsize = bgzfUba.length - 1;
    var b0 = (bsize & 0xff);
    var b1 = (bsize >> 8);
    bgzfUba[16] = b0;
    bgzfUba[17] = b1;
    return bgzfUba;
}

// Takes a uba composed of a series of bgzf blocks and appends the EOF
// block.
function addEOFblk (bgzfUba) {
    return appendBuffer(bgzfUba, EOFblk);
}

pub struct ZipEntry {
    pub name: String,
    pub data: Vec<u8>,
}

const ZIP_LOCAL_FILE_HEADER_SIGNATURE: u32 = 0x0403_4b50;
const ZIP_CENTRAL_DIRECTORY_HEADER_SIGNATURE: u32 = 0x0201_4b50;
const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE: u32 = 0x0605_4b50;
const ZIP_VERSION: u16 = 20;
const ZIP_UTF8_FLAG: u16 = 0x0800;

struct CentralRecord {
    name: Vec<u8>,
    crc32: u32,
    size: u32,
    offset: u32,
}

fn push_u16_le(buf: &mut Vec<u8>, value: u16) {
    buf.extend_from_slice(&value.to_le_bytes());
}

fn push_u32_le(buf: &mut Vec<u8>, value: u32) {
    buf.extend_from_slice(&value.to_le_bytes());
}

fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = 0xffff_ffffu32;
    for &byte in bytes {
        crc ^= byte as u32;
        for _ in 0..8 {
            let lsb = crc & 1;
            crc >>= 1;
            if lsb == 1 {
                crc ^= 0xedb8_8320;
            }
        }
    }
    !crc
}

pub fn create_zip(entries: Vec<ZipEntry>) -> Result<Vec<u8>, String> {
    let mut output = Vec::<u8>::new();
    let mut central_records = Vec::<CentralRecord>::new();

    for entry in entries.into_iter() {
        let name = entry.name.into_bytes();
        let data = entry.data;
        let name_len = u16::try_from(name.len()).map_err(|_| "File name too long")?;
        let size = u32::try_from(data.len()).map_err(|_| "File too large for ZIP32")?;
        let offset = u32::try_from(output.len()).map_err(|_| "ZIP too large for ZIP32")?;
        let crc = crc32(&data);

        push_u32_le(&mut output, ZIP_LOCAL_FILE_HEADER_SIGNATURE);
        push_u16_le(&mut output, ZIP_VERSION);
        push_u16_le(&mut output, ZIP_UTF8_FLAG);
        push_u16_le(&mut output, 0);
        push_u16_le(&mut output, 0);
        push_u16_le(&mut output, 0);
        push_u32_le(&mut output, crc);
        push_u32_le(&mut output, size);
        push_u32_le(&mut output, size);
        push_u16_le(&mut output, name_len);
        push_u16_le(&mut output, 0);
        output.extend_from_slice(&name);
        output.extend_from_slice(&data);

        central_records.push(CentralRecord {
            name,
            crc32: crc,
            size,
            offset,
        });
    }

    let central_offset = u32::try_from(output.len()).map_err(|_| "ZIP too large for ZIP32")?;
    for record in central_records.iter() {
        let name_len = u16::try_from(record.name.len()).map_err(|_| "File name too long")?;
        push_u32_le(&mut output, ZIP_CENTRAL_DIRECTORY_HEADER_SIGNATURE);
        push_u16_le(&mut output, ZIP_VERSION);
        push_u16_le(&mut output, ZIP_VERSION);
        push_u16_le(&mut output, ZIP_UTF8_FLAG);
        push_u16_le(&mut output, 0);
        push_u16_le(&mut output, 0);
        push_u16_le(&mut output, 0);
        push_u32_le(&mut output, record.crc32);
        push_u32_le(&mut output, record.size);
        push_u32_le(&mut output, record.size);
        push_u16_le(&mut output, name_len);
        push_u16_le(&mut output, 0);
        push_u16_le(&mut output, 0);
        push_u16_le(&mut output, 0);
        push_u16_le(&mut output, 0);
        push_u32_le(&mut output, 0);
        push_u32_le(&mut output, record.offset);
        output.extend_from_slice(&record.name);
    }

    let central_size = u32::try_from(output.len())
        .map_err(|_| "ZIP too large for ZIP32")?
        .saturating_sub(central_offset);
    let file_count =
        u16::try_from(central_records.len()).map_err(|_| "Too many files for ZIP32")?;

    push_u32_le(&mut output, ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE);
    push_u16_le(&mut output, 0);
    push_u16_le(&mut output, 0);
    push_u16_le(&mut output, file_count);
    push_u16_le(&mut output, file_count);
    push_u32_le(&mut output, central_size);
    push_u32_le(&mut output, central_offset);
    push_u16_le(&mut output, 0);

    Ok(output)
}

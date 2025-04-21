use anchor_lang::{prelude::Pubkey, AnchorDeserialize, AnchorSerialize};
use std::io;
use wormhole_io::Readable;

const PAYLOAD_ID_ALIVE: u8 = 0;
const PAYLOAD_ID_HELLO: u8 = 1;

pub const WH_MESSAGE_MAX_LENGTH: usize = 512;

#[derive(Clone)]
/// Expected message types for this program. Only valid payloads are:
/// * `Alive`: Payload ID == 0. Emitted when [`initialize`](crate::initialize)
///  is called).
/// * `Hello`: Payload ID == 1. Emitted when
/// [`send_message`](crate::send_message) is called).
///
/// Payload IDs are encoded as u8.
pub enum WhMessage {
    Alive { program_id: Pubkey },
    Hello { message: Vec<u8> },
}

impl AnchorSerialize for WhMessage {
    fn serialize<W: io::Write>(&self, writer: &mut W) -> io::Result<()> {
        match self {
            WhMessage::Alive { program_id } => {
                PAYLOAD_ID_ALIVE.serialize(writer)?;
                program_id.serialize(writer)
            }
            WhMessage::Hello { message } => {
                if message.len() > WH_MESSAGE_MAX_LENGTH {
                    Err(io::Error::new(
                        io::ErrorKind::InvalidInput,
                        format!("message exceeds {WH_MESSAGE_MAX_LENGTH} bytes"),
                    ))
                } else {
                    PAYLOAD_ID_HELLO.serialize(writer)?;
                    (message.len() as u16).to_be_bytes().serialize(writer)?;
                    for item in message {
                        item.serialize(writer)?;
                    }
                    Ok(())
                }
            }
        }
    }
}

impl AnchorDeserialize for WhMessage {
    fn deserialize_reader<R: io::Read>(reader: &mut R) -> io::Result<Self> {
        match u8::read(reader)? {
            PAYLOAD_ID_ALIVE => Ok(WhMessage::Alive {
                program_id: Pubkey::try_from(<[u8; 32]>::read(reader)?).unwrap(),
            }),
            PAYLOAD_ID_HELLO => {
                let length = u16::read(reader)? as usize;
                if length > WH_MESSAGE_MAX_LENGTH {
                    Err(io::Error::new(
                        io::ErrorKind::InvalidInput,
                        format!("message exceeds {WH_MESSAGE_MAX_LENGTH} bytes"),
                    ))
                } else {
                    let mut buf = vec![0; length];
                    reader.read_exact(&mut buf)?;
                    Ok(WhMessage::Hello { message: buf })
                }
            }
            _ => Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "invalid payload ID",
            )),
        }
    }
}

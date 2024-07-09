import io from "socket.io-client";
import CustomMic from "stt-streaming-pipeline/mic/customMic";
let customMic = null;
let socket = null;
let textWithGuidList = [];

export async function InitializeWebSocket(url, textBoxRef, punctuationUrl) {
  socket = io(url, {
    transports: ["websocket"],
  });

  socket.on("disconnected_from_server", ({ message }) => {
    StopRecording();
  });
  //  ............. event to take result...............
  socket.on("result", (message) => {
    let res = "";
    for (let wordData of message.output.predicted_words) {
      let word = wordData.word;
      let isConfident = wordData.is_confident;

      if (!isConfident && word !== " ") {
        res += `<${word}>`;
      } else {
        res += word;
      }
    }
    if (message.chunk === "small_chunk") {
      let textArray = [res];
      let textWithGuidObj = {
        guid: message.guid,
        graphemeArray: textArray,
        index: message.index,
        type: message.chunk,
      };
      let joinedList = [...textWithGuidList, textWithGuidObj];
      joinedList.sort(
        (a, b) =>
          parseInt(a.index.split(":")[0]) - parseInt(b.index.split(":")[0]),
      );
      textWithGuidList = [...joinedList];

      textBoxRef.current.innerText = textWithGuidList
        .map((textWithGuid) => textWithGuid["graphemeArray"][0])
        .join(" ");
    } else {
      getPunctuation(message, res, textBoxRef, punctuationUrl);
    }
  });

  socket.on("last_result", (message) => {
    if (message.chunk === "small_chunk") {
      let textArray = [message.output];
      let textWithGuidObj = {
        guid: message.guid,
        graphemeArray: textArray,
        index: message.output === "" ? null : message.index,
        type: "large_chunk",
      };
      let joinedList = [...textWithGuidList, textWithGuidObj];
      joinedList.sort(
        (a, b) =>
          parseInt(a.index.split(":")[0]) - parseInt(b.index.split(":")[0]),
      );
      textWithGuidList = [...joinedList];

      textBoxRef.current.innerText = textWithGuidList
        .map((textWithGuid) => textWithGuid["graphemeArray"][0])
        .join(" ");
    } else {
      let textArray = [message.output];
      let textWithGuidObj = {
        guid: message.guid,
        graphemeArray: textArray,
        index: message.output === "" ? null : message.index,
        type: "large_chunk",
      };
      let replacingIndices = message.index;
      let startIndex = parseInt(replacingIndices.split(":")[0]);
      let endIndex = parseInt(replacingIndices.split(":")[1]);

      let indicesToReplace = [];
      textWithGuidList.forEach((item, index) => {
        if (
          parseInt(item.index.split(":")[0]) >= startIndex &&
          parseInt(item.index.split(":")[0]) <= endIndex
        ) {
          indicesToReplace.push(index);
        }
      });
      if (index !== -1) {
        textWithGuidList.splice(indicesToReplace[0], indicesToReplace.length);
      }

      textWithGuidList.push(textWithGuidObj);
      textWithGuidList.sort(
        (a, b) =>
          parseInt(a.index.split(":")[0]) - parseInt(b.index.split(":")[0]),
      );
    }
  });
}

const getPunctuation = async (message, res, textBoxRef, punctuationUrl) => {
  const newList = textWithGuidList;

  // get the previous large chunks and append them
  let largeChunkData = "";
  newList.forEach((item) => {
    if (item.type === "large_chunk") {
      largeChunkData += item.graphemeArray.toString();
    }
  });

  // replace previous punctuations
  largeChunkData = largeChunkData.replace(/[,;।?!]+/g, "");

  let finalText = "";
  if (largeChunkData !== "") {
    finalText = largeChunkData + " " + res;
  } else {
    finalText = res;
  }
  var myHeaders = new Headers();
  myHeaders.append("Content-Type", "application/json");
  var raw = JSON.stringify({
    text: finalText.replace(/<|>/g, ""),
    module: "stt",
    submodule: "punctuation",
  });

  var requestOptions = {
    method: "POST",
    headers: myHeaders,
    body: raw,
    redirect: "follow",
  };

  try {
    const response = await fetch(punctuationUrl, requestOptions);
    const result = await response.json();

    let replacingIndices = message.index;
    // let startIndex = parseInt(replacingIndices.split(":")[0]);
    let endIndex = parseInt(replacingIndices.split(":")[1]);
    // Find the indices of the elements to replace
    // take only those indices which are greater or equal to startIndex and less than or equal to endIndex
    let indicesToReplace = [];

    newList.forEach((item, index) => {
      if (
        parseInt(item.index.split(":")[0]) >= 0 && // here the index start from 0 because, we want to delete all the data till new one
        parseInt(item.index.split(":")[0]) <= endIndex
      ) {
        indicesToReplace.push(index);
      }
    });
    newList.splice(indicesToReplace[0], indicesToReplace.length);

    let textArray = [result["punctuated_text"]];
    let textWithGuidObj = {
      guid: message.guid,
      graphemeArray: textArray,
      index: message.index,
      type: message.chunk,
    };
    newList.push(textWithGuidObj);
    newList.sort(
      (a, b) =>
        parseInt(a.index.split(":")[0]) - parseInt(b.index.split(":")[0]),
    );

    textWithGuidList = [...newList];
    textBoxRef.current.innerText = textWithGuidList
      .map((textWithGuid) => textWithGuid["graphemeArray"][0])
      .join(" ");
  } catch (error) {
    throw error; // Re-throw the error to propagate it further
  }
};
export async function StartRecording(
  CHUNK_SIZE,
  textBoxRef,
  SocketUrl,
  punctuationUrl,
) {
  // initialization
  await InitializeWebSocket(SocketUrl, textBoxRef, punctuationUrl);
  textWithGuidList = [];

  let currentStreamIndex = 0;
  customMic = new CustomMic(CHUNK_SIZE);
  await customMic.startMic();

  customMic.on("recordedData", (data) => {
    let wavBlob = new Blob([data[0]], { type: "audio/wav" });
    let endOfStream = data[1];
    const audioFileInWav = new File([wavBlob], `filename`, {
      type: "audio/wav",
    });
    const reader = new FileReader();
    reader.onload = (event) => {
      const base64String = event.target.result.split(",")[1];
      socket.emit("audio_transmit", {
        audio: base64String,
        index: currentStreamIndex,
        endOfStream: endOfStream,
      });
      currentStreamIndex += 1;
    };
    // reader.readAsBinaryString(audioFileInWav)N;
    reader.readAsDataURL(audioFileInWav); // Read the file as Data URL (Base64)
  });
}

export const StopRecording = () => {
  customMic.stopMic();
};

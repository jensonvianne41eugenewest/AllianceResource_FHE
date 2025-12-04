// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract AllianceResourceSharing_FHE is SepoliaConfig {
    struct EncryptedResource {
        uint256 id;
        euint32 encryptedPartType;    // Encrypted part type identifier
        euint32 encryptedQuantity;    // Encrypted available quantity
        euint32 encryptedLocation;    // Encrypted location code
        uint256 timestamp;
        address submitter;
    }
    
    struct DecryptedResource {
        string partType;
        uint32 quantity;
        string location;
        bool isRevealed;
    }

    uint256 public resourceCount;
    mapping(uint256 => EncryptedResource) public encryptedResources;
    mapping(uint256 => DecryptedResource) public decryptedResources;
    
    mapping(string => euint32) private encryptedTypeCount;
    string[] private typeList;
    
    mapping(uint256 => uint256) private requestToResourceId;
    
    event ResourceShared(uint256 indexed id, address indexed submitter, uint256 timestamp);
    event DecryptionRequested(uint256 indexed id);
    event ResourceDecrypted(uint256 indexed id);
    
    modifier onlySubmitter(uint256 resourceId) {
        require(msg.sender == encryptedResources[resourceId].submitter, "Not original submitter");
        _;
    }
    
    function shareEncryptedResource(
        euint32 encryptedPartType,
        euint32 encryptedQuantity,
        euint32 encryptedLocation
    ) public {
        resourceCount += 1;
        uint256 newId = resourceCount;
        
        encryptedResources[newId] = EncryptedResource({
            id: newId,
            encryptedPartType: encryptedPartType,
            encryptedQuantity: encryptedQuantity,
            encryptedLocation: encryptedLocation,
            timestamp: block.timestamp,
            submitter: msg.sender
        });
        
        decryptedResources[newId] = DecryptedResource({
            partType: "",
            quantity: 0,
            location: "",
            isRevealed: false
        });
        
        emit ResourceShared(newId, msg.sender, block.timestamp);
    }
    
    function requestResourceDecryption(uint256 resourceId) public onlySubmitter(resourceId) {
        EncryptedResource storage resource = encryptedResources[resourceId];
        require(!decryptedResources[resourceId].isRevealed, "Already decrypted");
        
        bytes32[] memory ciphertexts = new bytes32[](3);
        ciphertexts[0] = FHE.toBytes32(resource.encryptedPartType);
        ciphertexts[1] = FHE.toBytes32(resource.encryptedQuantity);
        ciphertexts[2] = FHE.toBytes32(resource.encryptedLocation);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptResource.selector);
        requestToResourceId[reqId] = resourceId;
        
        emit DecryptionRequested(resourceId);
    }
    
    function decryptResource(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 resourceId = requestToResourceId[requestId];
        require(resourceId != 0, "Invalid request");
        
        EncryptedResource storage eResource = encryptedResources[resourceId];
        DecryptedResource storage dResource = decryptedResources[resourceId];
        require(!dResource.isRevealed, "Already decrypted");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        (string memory partType, uint32 quantity, string memory location) = 
            abi.decode(cleartexts, (string, uint32, string));
        
        dResource.partType = partType;
        dResource.quantity = quantity;
        dResource.location = location;
        dResource.isRevealed = true;
        
        if (FHE.isInitialized(encryptedTypeCount[partType]) == false) {
            encryptedTypeCount[partType] = FHE.asEuint32(0);
            typeList.push(partType);
        }
        encryptedTypeCount[partType] = FHE.add(
            encryptedTypeCount[partType], 
            FHE.asEuint32(1)
        );
        
        emit ResourceDecrypted(resourceId);
    }
    
    function getDecryptedResource(uint256 resourceId) public view returns (
        string memory partType,
        uint32 quantity,
        string memory location,
        bool isRevealed
    ) {
        DecryptedResource storage r = decryptedResources[resourceId];
        return (r.partType, r.quantity, r.location, r.isRevealed);
    }
    
    function getEncryptedTypeCount(string memory partType) public view returns (euint32) {
        return encryptedTypeCount[partType];
    }
    
    function requestTypeCountDecryption(string memory partType) public {
        euint32 count = encryptedTypeCount[partType];
        require(FHE.isInitialized(count), "Part type not found");
        
        bytes32[] memory ciphertexts = new bytes32[](1);
        ciphertexts[0] = FHE.toBytes32(count);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptTypeCount.selector);
        requestToResourceId[reqId] = bytes32ToUint(keccak256(abi.encodePacked(partType)));
    }
    
    function decryptTypeCount(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 typeHash = requestToResourceId[requestId];
        string memory partType = getTypeFromHash(typeHash);
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        uint32 count = abi.decode(cleartexts, (uint32));
    }
    
    function bytes32ToUint(bytes32 b) private pure returns (uint256) {
        return uint256(b);
    }
    
    function getTypeFromHash(uint256 hash) private view returns (string memory) {
        for (uint i = 0; i < typeList.length; i++) {
            if (bytes32ToUint(keccak256(abi.encodePacked(typeList[i]))) == hash) {
                return typeList[i];
            }
        }
        revert("Part type not found");
    }
}
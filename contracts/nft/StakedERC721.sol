// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/access/AccessControlEnumerable.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Burnable.sol";
import "./interfaces/IStakedERC721.sol";

contract StakedERC721 is IStakedERC721, ERC721Enumerable, Pausable, AccessControlEnumerable {
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");
    mapping(uint256 => StakedInfo) private _stakedInfos;

    constructor(string memory name, string memory symbol) 
        ERC721(
            string(abi.encodePacked("Staked", " ", name)), 
            string(abi.encodePacked("S", symbol))
        )
    {
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _setupRole(PAUSER_ROLE, msg.sender);
        _pause(); //default pause
    }

    modifier onlyPauser() {
        require(hasRole(PAUSER_ROLE, _msgSender()), "StakedERC721.onlyPauser: permission denied");
        _;
    }

    modifier onlyMinter() {
        require(hasRole(MINTER_ROLE, _msgSender()), "StakedERC721.onlyMinter: permission denied");
        _;
    }

    modifier onlyBurner() {
        require(hasRole(BURNER_ROLE, _msgSender()), "StakedERC721.onlyBurner: permission denied");
        _;
    }

    function pause() public override onlyPauser() {
        _pause();
    }

    function unpause() public override onlyPauser() {
        _unpause();
    }

    function safeMint(address to, uint256 tokenId, StakedInfo memory stakedInfo) 
        public 
        override 
        onlyMinter()
    {
        require(
            stakedInfo.end >= stakedInfo.start, 
            "StakedERC721.safeMint: StakedInfo.end must be greater than StakedInfo.start"
        );
        require(
            stakedInfo.duration > 0, 
            "StakedERC721.safeMint: StakedInfo.duration must be greater than 0"
        );
        _stakedInfos[tokenId] = stakedInfo;
        _safeMint(to, tokenId);
    }

    function burn(uint256 tokenId) 
        public 
        override 
        onlyBurner()
    {
        StakedInfo storage stakedInfo = _stakedInfos[tokenId];
        require(block.timestamp >= stakedInfo.end, "StakedERC721.burn: Too soon.");
        delete _stakedInfos[tokenId];
        _burn(tokenId);
    }

    function stakedInfoOf(uint256 _tokenId) public view override returns (StakedInfo memory) {
        require(_exists(_tokenId), "StakedERC721.stakedInfoOf: stakedInfo query for the nonexistent token");
        return _stakedInfos[_tokenId];
    }

    function _transfer(address from, address to, uint256 tokenId)
        internal
        whenNotPaused
        override
    {
        super._transfer(from, to, tokenId);
    }

    // The following functions are overrides required by Solidity.
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721Enumerable, AccessControlEnumerable, IERC165)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}

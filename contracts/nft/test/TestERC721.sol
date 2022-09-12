// SPDX-License-Identifier: MIT
pragma solidity 0.8.7;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract TestERC721 is ERC721 {

    constructor(string memory _name, string memory _symbol) ERC721(_name, _symbol) {
        //silence
    }

    function mint(address _receiver, uint256 _tokenId) external {
        _mint(_receiver, _tokenId);
    }

    function burn(uint256 _tokenId) external {
        _burn(_tokenId);
    }
}